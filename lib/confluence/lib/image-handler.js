/**
 * Image and diagram handling functions for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/image-handler
 */

const fs = require('fs').promises
const path = require('path')
const https = require('https')
const { URL } = require('url')
const { execSync } = require('child_process')
const { confluenceRequest } = require('./api-client')
const { extractError } = require('./utils')

// Lazy load glob to avoid requiring it if not needed
let globModule = null
function getGlob () {
  if (!globModule) {
    try {
      globModule = require('glob')
    } catch (e) {
      // glob not available
    }
  }
  return globModule
}

// Use form-data package for multipart/form-data uploads
let FormData
try {
  FormData = require('form-data')
} catch (e) {
  console.error('❌ Error: form-data package is required for image uploads. Please install it: npm install form-data')
  process.exit(1)
}

/**
 * Configuration (will be set by main module)
 */
let CONFIG = {
  confluenceUrl: process.env.CONFLUENCE_URL || 'https://eaflood.atlassian.net'
}

/**
 * Set configuration (called by main module)
 * @param {Object} config - Configuration object
 */
function setConfig (config) {
  CONFIG = { ...CONFIG, ...config }
}

/**
 * Get image dimensions using sips (macOS) or identify (ImageMagick)
 * Returns: { width: number, height: number } or null
 * @param {string} imagePath - Path to image
 * @returns {Promise<Object|null>} Dimensions or null
 */
async function getImageDimensions (imagePath) {
  try {
    // Try sips (macOS) first
    if (execSync('command -v sips', { encoding: 'utf-8' }).trim()) {
      const width = execSync(`sips -g pixelWidth "${imagePath}"`, { encoding: 'utf-8' })
        .split('\n')
        .find(line => line.includes('pixelWidth'))
        ?.split(/\s+/)
        .pop()
      const height = execSync(`sips -g pixelHeight "${imagePath}"`, { encoding: 'utf-8' })
        .split('\n')
        .find(line => line.includes('pixelHeight'))
        ?.split(/\s+/)
        .pop()

      if (width && height) {
        return {
          width: parseInt(width, 10),
          height: parseInt(height, 10)
        }
      }
    }
  } catch (e) {
    // sips not available or failed
  }

  try {
    // Try identify (ImageMagick)
    if (execSync('command -v identify', { encoding: 'utf-8' }).trim()) {
      const dims = execSync(`identify -format "%w %h" "${imagePath}"`, { encoding: 'utf-8' }).trim().split(' ')
      if (dims.length === 2) {
        return {
          width: parseInt(dims[0], 10),
          height: parseInt(dims[1], 10)
        }
      }
    }
  } catch (e) {
    // identify not available or failed
  }

  return null
}

/**
 * Check if Mermaid CLI (mmdc) is available
 * @returns {Promise<string|null>} Path to mmdc command or null if not available
 */
let mermaidCliAvailable = null // Cache the result
async function checkMermaidCli () {
  if (mermaidCliAvailable !== null) {
    return mermaidCliAvailable
  }

  // Try the tooling package's node_modules first (delivery-info-arch-tooling)
  // This is the preferred location since mermaid-cli is a dependency of the tooling
  const toolingMmdc = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'mmdc')
  try {
    await fs.access(toolingMmdc)
    mermaidCliAvailable = toolingMmdc
    console.error(`    → Using Mermaid CLI from tooling package`)
    return mermaidCliAvailable
  } catch (e) {
    // Not in tooling package
  }

  // Try local project's node_modules/.bin/mmdc
  const localMmdc = path.join(process.cwd(), 'node_modules', '.bin', 'mmdc')
  try {
    await fs.access(localMmdc)
    mermaidCliAvailable = localMmdc
    return mermaidCliAvailable
  } catch (e) {
    // Not in local node_modules
  }

  // Try global mmdc
  try {
    execSync('command -v mmdc', { encoding: 'utf-8', stdio: 'pipe' })
    mermaidCliAvailable = 'mmdc'
    return mermaidCliAvailable
  } catch (e) {
    // Not available globally
  }

  // Not available
  mermaidCliAvailable = false
  return false
}

/**
 * Find Mermaid diagram image file
 * Looks for .mmd files and renders to PNG if needed
 * @param {string} diagramId - Diagram ID
 * @param {string} mmdDir - Directory for .mmd files
 * @param {string} outputDir - Output directory for rendered images
 * @returns {Promise<string|null>} Path to PNG image or null
 */
async function findMermaidDiagram (diagramId, mmdDir = 'architecture/current/btms/mmd', outputDir = 'build/mmd') {
  // Try to find the .mmd file
  const possibleMmdPaths = [
    path.join(mmdDir, `${diagramId}.mmd`),
    path.join('architecture/current/btms/mmd', `${diagramId}.mmd`),
    path.join('architecture/current', '**', 'mmd', `${diagramId}.mmd`)
  ]

  let mmdFile = null
  for (const mmdPath of possibleMmdPaths) {
    try {
      await fs.access(mmdPath)
      mmdFile = mmdPath
      break
    } catch (e) {
      // Try next path
    }
  }

  // If not found, try searching recursively
  if (!mmdFile) {
    try {
      const glob = getGlob()
      if (glob) {
        const globFn = glob.glob || glob
        const pattern = `**/mmd/${diagramId}.mmd`
        const matches = await globFn(pattern, { cwd: process.cwd() })
        if (matches && matches.length > 0) {
          mmdFile = matches[0]
        }
      }
    } catch (e) {
      // glob not available or search failed
    }
  }

  if (!mmdFile) {
    console.error(`    ⚠️  Mermaid diagram file not found: ${diagramId}.mmd`)
    return null
  }

  // Determine output path for PNG
  const relativePath = path.relative(process.cwd(), mmdFile)
  const pngFile = path.join(outputDir, relativePath.replace(/\.mmd$/, '.png'))

  // Check if PNG already exists
  try {
    await fs.access(pngFile)
    return pngFile
  } catch (e) {
    // PNG doesn't exist, need to render it
  }

  // Render Mermaid diagram to PNG
  try {
    const pngDir = path.dirname(pngFile)
    await fs.mkdir(pngDir, { recursive: true })

    // Check if Mermaid CLI is available before trying to render
    const mmdcPath = await checkMermaidCli()
    if (!mmdcPath) {
      console.error(`    ⚠️  Mermaid CLI (mmdc) not available - cannot render ${diagramId}.mmd`)
      console.error(`    💡 To enable Mermaid diagrams, install the CLI:`)
      console.error(`       npm install --save-dev @mermaid-js/mermaid-cli`)
      console.error(`    💡 Or pre-render diagrams to: ${outputDir}/${diagramId}.png`)
      return null
    }

    console.error(`    → Rendering Mermaid diagram: ${diagramId} -> ${path.basename(pngFile)}`)

    try {
      // Use the detected mmdc path
      const mmdcCmd = mmdcPath === 'mmdc' ? 'mmdc' : `"${mmdcPath}"`
      execSync(
        `${mmdcCmd} -i "${mmdFile}" -o "${pngFile}" -b white -w 1800`,
        { stdio: 'inherit' }
      )

      // Verify the file was created
      try {
        await fs.access(pngFile)
        return pngFile
      } catch (e) {
        console.error(`    ⚠️  Mermaid diagram rendered but file not found: ${pngFile}`)
        return null
      }
    } catch (error) {
      console.error(`    ⚠️  Failed to render Mermaid diagram ${diagramId}: ${error.message}`)
      return null
    }
  } catch (error) {
    console.error(`    ⚠️  Failed to render Mermaid diagram ${diagramId}: ${error.message}`)
    return null
  }
}

/**
 * Export a specific LikeC4 view to an image
 * @param {string} viewId - View ID to export
 * @param {string} sourceDir - Source directory with .c4 files
 * @param {string} exportsDir - Output directory for images
 * @param {string} format - Output format: 'png' or 'svg' (default: 'png')
 * @returns {Promise<string|null>} Path to exported image or null
 */
async function exportDiagramImage (viewId, sourceDir = 'architecture', exportsDir = 'generated/diagrams', format = 'png') {
  try {
    // Check if source directory exists
    try {
      await fs.access(sourceDir)
    } catch (e) {
      console.error(`    ⚠️  Source directory does not exist: ${sourceDir}`)
      return null
    }

    // Ensure output directory exists
    await fs.mkdir(exportsDir, { recursive: true })

    console.error(`    → Exporting diagram for view '${viewId}' from '${sourceDir}' to '${exportsDir}'...`)

    // Export using likec4 CLI with filter for specific view
    // Capture both stdout and stderr to see what's happening
    try {
      execSync(
        `npx likec4 export ${format} "${sourceDir}" -o "${exportsDir}" -f "${viewId}"`,
        { 
          encoding: 'utf-8',
          stdio: 'inherit' // Show output so user can see what's happening
        }
      )
    } catch (execError) {
      // execSync throws on non-zero exit
      const errorMsg = execError.stderr?.toString() || execError.stdout?.toString() || execError.message || 'Unknown error'
      console.error(`    ⚠️  Export command failed: ${errorMsg.substring(0, 300)}`)
      // Still try to find files - maybe partial export succeeded
    }

    // List files in exports directory to debug
    let allFiles = []
    try {
      allFiles = await fs.readdir(exportsDir)
      const imageFiles = allFiles.filter(f => f.endsWith('.png') || f.endsWith('.svg'))
      if (imageFiles.length > 0) {
        console.error(`    → Found ${imageFiles.length} image file(s) in exports directory`)
      }
    } catch (e) {
      console.error(`    ⚠️  Could not read exports directory: ${e.message}`)
    }

    // Try to find the exported image - check immediately after export
    const imagePath = await findDiagramImage(viewId, exportsDir)
    if (imagePath) {
      console.error(`    ✅ Successfully exported diagram for view '${viewId}': ${path.basename(imagePath)}`)
      return imagePath
    } else {
      // Try a broader search - maybe the file was created with a different name
      try {
        const imageFiles = allFiles.filter(f => 
          (f.endsWith('.png') || f.endsWith('.svg')) &&
          (f.toLowerCase().includes(viewId.toLowerCase()) || 
           path.basename(f, path.extname(f)).toLowerCase() === viewId.toLowerCase())
        )
        
        if (imageFiles.length > 0) {
          const foundPath = path.join(exportsDir, imageFiles[0])
          console.error(`    ✅ Found exported diagram with different name: ${imageFiles[0]}`)
          return foundPath
        }
      } catch (e) {
        // Ignore
      }
      
      console.error(`    ⚠️  Diagram exported but image file not found for view '${viewId}'`)
      console.error(`    → Checked directory: ${path.resolve(exportsDir)}`)
      console.error(`    → Source directory: ${path.resolve(sourceDir)}`)
      if (allFiles.length > 0) {
        console.error(`    → Available files: ${allFiles.slice(0, 10).join(', ')}${allFiles.length > 10 ? '...' : ''}`)
      }
      return null
    }
  } catch (error) {
    console.error(`    ⚠️  Failed to export diagram for view '${viewId}': ${error.message}`)
    return null
  }
}

/**
 * Recursively search for a file in a directory
 * @param {string} dir - Directory to search
 * @param {string} filename - Filename to find
 * @returns {Promise<string|null>} Path to file or null
 */
async function findFileRecursive (dir, filename) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      
      if (entry.isFile() && entry.name === filename) {
        return fullPath
      } else if (entry.isDirectory()) {
        // Recursively search subdirectories
        const found = await findFileRecursive(fullPath, filename)
        if (found) {
          return found
        }
      }
    }
  } catch (e) {
    // Directory doesn't exist or can't read
  }
  
  return null
}

/**
 * Find diagram image file for a view ID
 * @param {string} viewId - View ID
 * @param {string} exportsDir - Exports directory
 * @returns {Promise<string|null>} Path to image or null
 */
async function findDiagramImage (viewId, exportsDir = 'generated/diagrams') {
  // Special handling for "index" view
  if (viewId === 'index') {
    const indexNames = [
      path.join(exportsDir, 'index.png'),
      path.join(exportsDir, 'Index.png'),
      path.join(exportsDir, 'INDEX.png'),
      path.join(exportsDir, 'index.svg'),
      path.join(exportsDir, 'Index.svg')
    ]

    for (const name of indexNames) {
      try {
        await fs.access(name)
        return name
      } catch (e) {
        // File doesn't exist, try next
      }
    }
  }

  // Try different possible filenames (flat structure first)
  const possibleNames = [
    `${viewId}.png`,
    `${viewId}.svg`,
    `${viewId.charAt(0).toLowerCase() + viewId.slice(1)}.png`,
    `${viewId.charAt(0).toLowerCase() + viewId.slice(1)}.svg`,
    `${viewId.charAt(0).toUpperCase() + viewId.slice(1)}.png`,
    `${viewId.charAt(0).toUpperCase() + viewId.slice(1)}.svg`
  ]

  // First try flat structure (directly in exportsDir)
  for (const name of possibleNames) {
    const fullPath = path.join(exportsDir, name)
    try {
      await fs.access(fullPath)
      return fullPath
    } catch (e) {
      // File doesn't exist, try next
    }
  }

  // If not found in flat structure, search recursively in subdirectories
  // (likec4 export preserves directory structure: current/btms/c4/viewId.png)
  for (const name of possibleNames) {
    const found = await findFileRecursive(exportsDir, name)
    if (found) {
      return found
    }
  }

  // Try to find any file containing the view_id in the name (case-insensitive, recursive)
  try {
    const viewLower = viewId.toLowerCase()
    
    async function searchRecursive (dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        
        if (entry.isFile()) {
          const fileName = entry.name.toLowerCase()
          if (fileName.includes(viewLower) && (fileName.endsWith('.png') || fileName.endsWith('.svg'))) {
            return fullPath
          }
        } else if (entry.isDirectory()) {
          const found = await searchRecursive(fullPath)
          if (found) {
            return found
          }
        }
      }
      return null
    }
    
    const found = await searchRecursive(exportsDir)
    if (found) {
      return found
    }
  } catch (e) {
    // Directory doesn't exist or can't read
  }

  return null
}

/**
 * Upload image attachment to a Confluence page
 * Returns: { attachmentId: string, fileId: string, filename: string } or null
 * @param {string} pageId - Page ID
 * @param {string} imagePath - Path to image
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object|null>} Attachment info or null
 */
async function uploadImageAttachment (pageId, imagePath, auth) {
  const filename = path.basename(imagePath)

  try {
    await fs.access(imagePath)
  } catch (e) {
    console.error(`    ⚠️  Image not found: ${imagePath}`)
    return null
  }

  console.error(`    → Uploading image: ${filename}`)

  // Check if attachment already exists
  let existingAttachment = null
  try {
    const response = await confluenceRequest('GET',
      `/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}`,
      { auth }
    )

    if (response.status === 200 && response.body && response.body.results && response.body.results.length > 0) {
      existingAttachment = response.body.results[0]
    }
  } catch (e) {
    // Attachment doesn't exist, will create new
  }

  // Determine upload URL
  let uploadUrl = `/content/${pageId}/child/attachment`
  if (existingAttachment && existingAttachment.id) {
    uploadUrl = `/content/${pageId}/child/attachment/${existingAttachment.id}/data`
    console.error(`    → Updating existing attachment (ID: ${existingAttachment.id})`)
  }

  // Upload using multipart/form-data
  const formData = new FormData()
  const fileStream = require('fs').createReadStream(imagePath)
  formData.append('file', fileStream, {
    filename,
    contentType: filename.endsWith('.png') ? 'image/png' : (filename.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream')
  })
  formData.append('comment', existingAttachment ? 'Diagram exported from LikeC4 (updated)' : 'Diagram exported from LikeC4')

  try {
    const url = new URL(`${CONFIG.confluenceUrl}/wiki/rest/api${uploadUrl}`)
    const authHeader = `Basic ${Buffer.from(`${auth.username}:${auth.apiToken}`).toString('base64')}`
    const formHeaders = formData.getHeaders()

    const headers = {
      Authorization: authHeader,
      'X-Atlassian-Token': 'no-check',
      ...formHeaders
    }

    const response = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            text: async () => data,
            json: async () => {
              try {
                return JSON.parse(data)
              } catch (e) {
                return data
              }
            }
          })
        })
      })

      req.on('error', (error) => {
        reject(error)
      })

      formData.pipe(req)

      formData.on('error', (error) => {
        reject(error)
      })
    })

    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch (e) {
      body = text
    }

    if (response.status === 200 || response.status === 201) {
      console.error('    ✅ Image uploaded successfully')

      let attachmentId = existingAttachment?.id || body.results?.[0]?.id || body.id || null
      let fileId = existingAttachment?.extensions?.fileId || body.results?.[0]?.extensions?.fileId || body.extensions?.fileId || null
      let storedFilename = existingAttachment?.title || body.results?.[0]?.title || body.title || filename

      if (!attachmentId || !fileId) {
        try {
          const listResponse = await confluenceRequest('GET',
            `/content/${pageId}/child/attachment`,
            { auth }
          )

          if (listResponse.status === 200 && listResponse.body && listResponse.body.results) {
            const matching = listResponse.body.results.find(att =>
              att.title && att.title.toLowerCase() === storedFilename.toLowerCase()
            )

            if (matching) {
              if (!attachmentId) attachmentId = matching.id
              if (!fileId) fileId = matching.extensions?.fileId || null
              if (!storedFilename) storedFilename = matching.title
            }
          }
        } catch (e) {
          // Could not query attachment list
        }
      }

      if (attachmentId) {
        console.error(`    ✅ Verified attachment exists on page: ${attachmentId}`)
        if (fileId) {
          console.error(`    📎 Using file ID: ${fileId} (attachment: ${attachmentId}, filename: ${storedFilename})`)
        } else {
          console.error(`    ⚠️  Warning: No fileId found, using attachment ID: ${attachmentId}`)
        }
      }

      return {
        attachmentId: attachmentId || '',
        fileId: fileId || '',
        filename: storedFilename
      }
    } else {
      const errorMsg = extractError(body)
      console.error(`    ❌ Failed to upload image (HTTP ${response.status}): ${errorMsg}`)
      return null
    }
  } catch (error) {
    console.error(`    ❌ Failed to upload image: ${error.message}`)
    return null
  }
}

/**
 * Replace image placeholders in Atlas Document Format JSON
 * @param {Object|string} atlasJson - Atlas document
 * @param {Array} placeholderData - Placeholder data
 * @param {string} pageId - Page ID
 * @returns {Promise<Object>} Modified atlas document
 */
async function replaceImagePlaceholdersAtlas (atlasJson, placeholderData, pageId) {
  if (!placeholderData || placeholderData.length === 0) {
    return atlasJson
  }

  if (!pageId) {
    console.error('    ⚠️  Warning: Page ID not provided for media node collection')
  }

  console.error('    🔍 Replacing image placeholders in atlas_doc_format...')

  let atlasDoc
  if (typeof atlasJson === 'string') {
    try {
      atlasDoc = JSON.parse(atlasJson)
    } catch (e) {
      throw new Error(`Invalid JSON in atlas document: ${e.message}`)
    }
  } else {
    atlasDoc = atlasJson
  }

  for (const item of placeholderData) {
    const { viewId, imagePath, attachmentInfo, originalPath } = item

    if (!attachmentInfo || (!viewId && !originalPath)) {
      continue
    }

    const parts = attachmentInfo.split('|')
    const attachmentId = parts[0] || ''
    const fileId = parts[1] || ''
    const attachmentFilename = parts[2] || attachmentInfo

    let mediaId = fileId || attachmentId
    if (!fileId && attachmentId && attachmentId.startsWith('att')) {
      mediaId = attachmentId.replace(/^att/, '')
      console.error(`    ⚠️  Warning: No file ID for '${viewId || originalPath}', falling back to attachment ID: ${mediaId}`)
    } else {
      console.error(`    🔍 Replacing image '${viewId || originalPath}' with file ID: ${fileId} (attachment: ${attachmentId})`)
    }

    const collectionId = pageId ? `contentId-${pageId}` : ''
    if (!collectionId) {
      console.error('    ⚠️  Warning: No page ID available for collection')
    }

    const targetWidth = 1600
    let imageHeight = 928

    if (imagePath) {
      try {
        const dims = await getImageDimensions(imagePath)
        if (dims && dims.width > 0) {
          imageHeight = Math.round(targetWidth * dims.height / dims.width)
          console.error(`    🔍 Image dimensions: ${dims.width}x${dims.height}, scaled to ${targetWidth}x${imageHeight}`)
        }
      } catch (e) {
        // Could not get dimensions, use default
      }
    }

    // Replace by placeholder viewId (for LikeC4/Mermaid) or by originalPath (for manual diagrams)
    atlasDoc = replaceMediaPlaceholderInNode(atlasDoc, viewId || originalPath, mediaId, collectionId, targetWidth, imageHeight, originalPath)
  }

  return atlasDoc
}

/**
 * Recursively replace media placeholder in ADF node structure
 */
function replaceMediaPlaceholderInNode (node, viewId, mediaId, collectionId, width, height, originalPath) {
  if (typeof node !== 'object' || node === null) {
    return node
  }

  // Match by placeholder viewId (for LikeC4/Mermaid) or by URL (for manual diagrams)
  const matchesPlaceholder = node.type === 'media' && node.attrs && node.attrs.__placeholder_viewid === viewId
  const matchesUrl = originalPath && node.type === 'media' && node.attrs && node.attrs.url && 
                     (node.attrs.url === originalPath || node.attrs.url.endsWith(originalPath))
  
  if (matchesPlaceholder || matchesUrl) {
    return {
      type: 'mediaSingle',
      attrs: {
        layout: 'center'
      },
      content: [
        {
          type: 'media',
          attrs: {
            type: 'file',
            collection: collectionId,
            id: mediaId,
            width,
            height
          }
        }
      ]
    }
  }

  if (node.type === 'paragraph' && Array.isArray(node.content) && node.content.length === 1) {
    const child = node.content[0]
    const childMatchesPlaceholder = child.type === 'media' && child.attrs && child.attrs.__placeholder_viewid === viewId
    const childMatchesUrl = originalPath && child.type === 'media' && child.attrs && child.attrs.url && 
                            (child.attrs.url === originalPath || child.attrs.url.endsWith(originalPath))
    
    if (childMatchesPlaceholder || childMatchesUrl) {
      return {
        type: 'mediaSingle',
        attrs: {
          layout: 'center'
        },
        content: [
          {
            type: 'media',
            attrs: {
              type: 'file',
              collection: collectionId,
              id: mediaId,
              width,
              height
            }
          }
        ]
      }
    }
  }

  if (Array.isArray(node.content)) {
    node.content = node.content.map(child => replaceMediaPlaceholderInNode(child, viewId, mediaId, collectionId, width, height, originalPath))
  }

  return node
}

/**
 * Replace image placeholders in storage format content
 * @param {string} content - Content
 * @param {Array} placeholderData - Placeholder data
 * @param {string} format - Output format
 * @returns {string} Modified content
 */
function replaceImagePlaceholders (content, placeholderData, format = 'storage') {
  if (format === 'atlas') {
    return content
  }

  if (!placeholderData || placeholderData.length === 0) {
    return content
  }

  console.error('    🔍 Replacing image placeholders...')

  let result = content

  for (const item of placeholderData) {
    const { viewId, attachmentInfo } = item

    if (!attachmentInfo || !viewId) {
      continue
    }

    const parts = attachmentInfo.split('|')
    const attachmentFilename = parts.length >= 2 ? parts[1] : (parts[0] || attachmentInfo)

    const encodedFilename = attachmentFilename
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

    let imageWidth = '1200'
    const viewLower = viewId.toLowerCase()
    if (viewLower.includes('network') || viewLower.includes('architecture') ||
      viewLower.includes('infrastructure') || viewLower.includes('deployment')) {
      imageWidth = '1600'
    } else if (viewLower.includes('flow') || viewLower.includes('endtoend') ||
      viewLower.includes('submission') || viewLower.includes('processing')) {
      imageWidth = '900'
    }

    const imageEmbed = `<ac:image ac:width="${imageWidth}"><ri:attachment ri:filename="${encodedFilename}"/></ac:image>`

    result = result.replace(
      new RegExp(`<p>\\s*<ac:image-placeholder-viewid="${viewId}"/>\\s*</p>`, 'g'),
      imageEmbed
    )
    result = result.replace(
      new RegExp(`<p><ac:image-placeholder-viewid="${viewId}"/></p>`, 'g'),
      imageEmbed
    )
    result = result.replace(
      new RegExp(`<ac:image-placeholder-viewid="${viewId}"/>`, 'g'),
      imageEmbed
    )
  }

  return result
}

/**
 * Convert diagram page (JSX components) to embedded images
 * @param {string} filePath - Path to file
 * @param {string} title - Page title
 * @param {string} exportsDir - Exports directory
 * @param {string} sourceDir - Source directory with .c4 files (for auto-export)
 * @param {string} preprocessedContent - Optional preprocessed content (if Mermaid diagrams already processed)
 * @returns {Promise<Object>} Result object
 */
async function convertDiagramPage (filePath, title, exportsDir = 'generated/diagrams', sourceDir = 'architecture', preprocessedContent = null) {
  const { readFileContent, filterContentForFormat } = require('./content-processor')

  let content = preprocessedContent
  if (!content) {
    content = await readFileContent(filePath)
    content = filterContentForFormat(content, 'confluence')
  }

  // Remove import statements
  content = content.split('\n').filter(line => !line.trim().startsWith('import ')).join('\n')

  // Extract view IDs from LikeC4View components
  const viewIdRegex = /<LikeC4View[^>]*viewId="([^"]*)"[^>]*\/?>/g
  const viewIds = []
  let match
  while ((match = viewIdRegex.exec(content)) !== null) {
    if (!viewIds.includes(match[1])) {
      viewIds.push(match[1])
    }
  }

  const placeholders = []
  let processedContent = content

  for (const viewId of viewIds) {
    let imagePath = await findDiagramImage(viewId, exportsDir)

    // If image not found, try to export it automatically
    if (!imagePath) {
      console.error(`    ⚠️  No exported image found for view '${viewId}', attempting to export...`)
      imagePath = await exportDiagramImage(viewId, sourceDir, exportsDir, 'png')
    }

    if (imagePath) {
      const filename = path.basename(imagePath)
      placeholders.push({
        viewId,
        imagePath,
        filename
      })

      processedContent = processedContent.replace(
        new RegExp(`<LikeC4View[^>]*viewId="${viewId}"[^>]*/>`, 'g'),
        `<ac:image-placeholder-viewid="${viewId}"/>`
      )
      processedContent = processedContent.replace(
        new RegExp(`<LikeC4View[^>]*viewId="${viewId}"[^>]*>.*?</LikeC4View>`, 'gs'),
        `<ac:image-placeholder-viewid="${viewId}"/>`
      )

      console.error(`    → Found diagram image for view '${viewId}': ${filename}`)
    } else {
      console.error(`    ❌ Could not find or export diagram for view '${viewId}'`)
      processedContent = processedContent.replace(
        new RegExp(`<LikeC4View[^>]*viewId="${viewId}"[^>]*/>`, 'g'),
        `*Diagram for view '${viewId}' not available*`
      )
    }
  }

  // Remove any remaining LikeC4View components
  processedContent = processedContent.replace(/<LikeC4View[^>]*\/>/g, '')
  processedContent = processedContent.replace(/<LikeC4View[^>]*>.*?<\/LikeC4View>/gs, '')

  // Convert to atlas_doc_format
  const { convertMarkdownToAtlasDoc, convertMarkdownToStorage } = require('./content-processor')
  let useAtlasFormat = false
  let convertedContent

  try {
    convertedContent = await convertMarkdownToAtlasDoc(processedContent)
    useAtlasFormat = true
  } catch (e) {
    console.error('    ⚠️  Warning: Falling back to storage format for diagram page')
    convertedContent = convertMarkdownToStorage(processedContent)
    useAtlasFormat = false
  }

  return {
    content: convertedContent,
    useAtlasFormat,
    placeholders
  }
}

module.exports = {
  setConfig,
  getImageDimensions,
  findDiagramImage,
  exportDiagramImage,
  findMermaidDiagram,
  uploadImageAttachment,
  replaceImagePlaceholdersAtlas,
  replaceImagePlaceholders,
  convertDiagramPage
}

