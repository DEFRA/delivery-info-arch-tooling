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

    console.error(`    → Rendering Mermaid diagram: ${diagramId} -> ${path.basename(pngFile)}`)

    execSync(
      `npx mmdc -i "${mmdFile}" -o "${pngFile}" -b white -w 1800`,
      { stdio: 'inherit' }
    )

    return pngFile
  } catch (error) {
    console.error(`    ⚠️  Failed to render Mermaid diagram ${diagramId}: ${error.message}`)
    return null
  }
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

  // Try different possible filenames
  const possibleNames = [
    path.join(exportsDir, `${viewId}.png`),
    path.join(exportsDir, `${viewId}.svg`),
    path.join(exportsDir, `${viewId.charAt(0).toLowerCase() + viewId.slice(1)}.png`),
    path.join(exportsDir, `${viewId.charAt(0).toLowerCase() + viewId.slice(1)}.svg`),
    path.join(exportsDir, `${viewId.charAt(0).toUpperCase() + viewId.slice(1)}.png`),
    path.join(exportsDir, `${viewId.charAt(0).toUpperCase() + viewId.slice(1)}.svg`)
  ]

  for (const name of possibleNames) {
    try {
      await fs.access(name)
      return name
    } catch (e) {
      // File doesn't exist, try next
    }
  }

  // Try to find any file containing the view_id in the name (case-insensitive)
  try {
    const files = await fs.readdir(exportsDir)
    const viewLower = viewId.toLowerCase()

    for (const file of files) {
      if (file.toLowerCase().includes(viewLower)) {
        const fullPath = path.join(exportsDir, file)
        const stat = await fs.stat(fullPath)
        if (stat.isFile()) {
          return fullPath
        }
      }
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
    const { viewId, imagePath, attachmentInfo } = item

    if (!attachmentInfo || !viewId) {
      continue
    }

    const parts = attachmentInfo.split('|')
    const attachmentId = parts[0] || ''
    const fileId = parts[1] || ''
    const attachmentFilename = parts[2] || attachmentInfo

    let mediaId = fileId || attachmentId
    if (!fileId && attachmentId && attachmentId.startsWith('att')) {
      mediaId = attachmentId.replace(/^att/, '')
      console.error(`    ⚠️  Warning: No file ID for view '${viewId}', falling back to attachment ID: ${mediaId}`)
    } else {
      console.error(`    🔍 Replacing placeholder for view '${viewId}' with file ID: ${fileId} (attachment: ${attachmentId})`)
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

    atlasDoc = replaceMediaPlaceholderInNode(atlasDoc, viewId, mediaId, collectionId, targetWidth, imageHeight)
  }

  return atlasDoc
}

/**
 * Recursively replace media placeholder in ADF node structure
 */
function replaceMediaPlaceholderInNode (node, viewId, mediaId, collectionId, width, height) {
  if (typeof node !== 'object' || node === null) {
    return node
  }

  if (node.type === 'media' && node.attrs && node.attrs.__placeholder_viewid === viewId) {
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
    if (child.type === 'media' && child.attrs && child.attrs.__placeholder_viewid === viewId) {
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
    node.content = node.content.map(child => replaceMediaPlaceholderInNode(child, viewId, mediaId, collectionId, width, height))
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
 * @returns {Promise<Object>} Result object
 */
async function convertDiagramPage (filePath, title, exportsDir = 'generated/diagrams') {
  const { readFileContent, filterContentForFormat } = require('./content-processor')

  let content = await readFileContent(filePath)
  content = filterContentForFormat(content, 'confluence')

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
    const imagePath = await findDiagramImage(viewId, exportsDir)

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
      console.error(`    ⚠️  No exported image found for view '${viewId}'`)
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
  findMermaidDiagram,
  uploadImageAttachment,
  replaceImagePlaceholdersAtlas,
  replaceImagePlaceholders,
  convertDiagramPage
}

