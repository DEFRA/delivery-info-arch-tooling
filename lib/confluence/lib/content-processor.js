/**
 * Content processing functions for markdown and Confluence formats
 * @module @defra/delivery-info-arch-tooling/confluence/content-processor
 */

const fs = require('fs').promises
const path = require('path')
const { spawn } = require('child_process')

/**
 * Read file content, skipping frontmatter if present
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} File content without frontmatter
 */
async function readFileContent (filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Skip frontmatter if present
    if (content.startsWith('---')) {
      const endIndex = content.indexOf('---', 3)
      if (endIndex !== -1) {
        return content.substring(endIndex + 3).trim()
      }
    }

    return content
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error.message}`)
  }
}

/**
 * Filter content for specific output format
 * @param {string} content - Markdown content
 * @param {string} format - Target format (confluence, ppt, github)
 * @returns {string} Filtered content
 */
function filterContentForFormat (content, format) {
  if (format === 'confluence') {
    // Remove PPT_ONLY and GITHUB_ONLY blocks
    content = content.replace(
      /<!--\s*PPT_ONLY\s*-->[\s\S]*?<!--\s*\/\s*PPT_ONLY\s*-->/gi,
      ''
    )
    content = content.replace(
      /<!--\s*GITHUB_ONLY\s*-->[\s\S]*?<!--\s*\/\s*GITHUB_ONLY\s*-->/gi,
      ''
    )
    // Remove CONFLUENCE_ONLY markers (keep content)
    content = content.replace(/<!--\s*CONFLUENCE_ONLY\s*-->/gi, '')
    content = content.replace(/<!--\s*\/\s*CONFLUENCE_ONLY\s*-->/gi, '')
    // Remove Astro/MDX note blocks
    content = content.replace(/^:::[a-zA-Z]+(\[[^\]]*\])?[\s\S]*?^:::$/gm, '')
  }

  return content
}

/**
 * Extract title from markdown file
 * Tries frontmatter first, then first H1, then filename
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Extracted title
 */
async function extractTitle (filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8')

    // Try frontmatter first
    const frontmatterMatch = content.match(/^---\s*\ntitle:\s*(.+?)\s*\n/)
    if (frontmatterMatch) {
      let title = frontmatterMatch[1].trim()
      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')
      if (title) {
        return title
      }
    }

    // If no frontmatter, try first H1
    const h1Match = content.match(/^#\s+(.+?)$/m)
    if (h1Match) {
      return h1Match[1].trim()
    }

    // If still no title, use filename
    const basename = path.basename(filePath, path.extname(filePath))
    return basename
      .replace(/-/g, ' ')
      .replace(/adr/gi, 'ADR-')
  } catch (error) {
    // Fallback to filename on error
    const basename = path.basename(filePath, path.extname(filePath))
    return basename.replace(/-/g, ' ')
  }
}

/**
 * Convert markdown to Confluence Atlas Document Format
 * Uses the markdown-to-atlas-doc.js converter
 * @param {string} content - Markdown content
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} Atlas document JSON
 */
async function convertMarkdownToAtlasDoc (content, options = {}) {
  const converterScript = path.join(__dirname, '..', 'markdown-to-atlas-doc.js')

  try {
    // Check if converter script exists
    await fs.access(converterScript)

    // Use Node.js to run the converter
    return new Promise((resolve, reject) => {
      const nodeProcess = spawn('node', [converterScript], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      nodeProcess.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      nodeProcess.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      nodeProcess.on('close', (code) => {
        if (code === 0 && stdout) {
          try {
            // Parse the JSON output
            const atlasDoc = JSON.parse(stdout)
            resolve(atlasDoc)
          } catch (parseError) {
            reject(new Error(`Failed to parse converter output: ${parseError.message}`))
          }
        } else {
          reject(new Error(`Converter failed: ${stderr || 'Unknown error'}`))
        }
      })

      // Send content to stdin
      nodeProcess.stdin.write(content)
      nodeProcess.stdin.end()
    })
  } catch (error) {
    throw new Error(`Converter script not found or not accessible: ${error.message}`)
  }
}

/**
 * Convert markdown to Confluence storage format (fallback)
 * This is a simplified conversion
 * @param {string} content - Markdown content
 * @returns {string} Storage format content
 */
function convertMarkdownToStorage (content) {
  let storageContent = content

  // Convert headers
  storageContent = storageContent.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  storageContent = storageContent.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  storageContent = storageContent.replace(/^# (.*$)/gim, '<h1>$1</h1>')

  // Convert bold
  storageContent = storageContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  // Convert italic
  storageContent = storageContent.replace(/\*(.*?)\*/g, '<em>$1</em>')

  // Convert code blocks
  storageContent = storageContent.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```/g, '').trim()
    return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">text</ac:parameter><ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`
  })

  // Convert inline code
  storageContent = storageContent.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Convert links
  storageContent = storageContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Convert paragraphs (basic)
  storageContent = storageContent.split('\n\n').map(para => {
    if (para.trim() && !para.match(/^<[h|a|]/)) {
      return `<p>${para.trim()}</p>`
    }
    return para
  }).join('\n\n')

  return storageContent
}

/**
 * Add warning panel to Atlas Document Format JSON
 * @param {Object|string} atlasJson - Atlas document
 * @param {string} githubUrl - GitHub source URL
 * @returns {Object} Modified atlas document
 */
function addWarningPanelToAtlas (atlasJson, githubUrl) {
  if (!githubUrl) {
    return atlasJson
  }

  // If atlasJson is a string, parse it
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

  // Create warning panel node
  const warningPanel = {
    type: 'panel',
    attrs: {
      panelType: 'warning'
    },
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'This page was automatically generated from '
          },
          {
            type: 'text',
            marks: [{ type: 'link', attrs: { href: githubUrl } }],
            text: 'source on GitHub'
          },
          {
            type: 'text',
            text: '. Do not edit directly as your edits may be overwritten.'
          }
        ]
      }
    ]
  }

  // Always insert warning panel at the very beginning
  if (!atlasDoc.content) {
    atlasDoc.content = []
  }
  atlasDoc.content = [warningPanel, ...atlasDoc.content]

  return atlasDoc
}

/**
 * Add warning panel to markdown content (for storage format)
 * @param {string} content - Content
 * @param {string} githubUrl - GitHub source URL
 * @param {boolean} useAtlasFormat - Whether using Atlas format
 * @returns {string} Modified content
 */
function addWarningPanelToContent (content, githubUrl, useAtlasFormat = false) {
  if (!githubUrl) {
    return content
  }

  if (useAtlasFormat) {
    // For atlas format, we'll add it in the JSON conversion
    return content
  }

  // For storage format, add as Confluence info panel macro
  const warningPanel = `<ac:structured-macro ac:name="warning" ac:schema-version="1">
<ac:rich-text-body>
<p>This page was automatically generated from <a href="${githubUrl}">source on GitHub</a>. Do not directly edit as your edits may be overwritten from source.</p>
</ac:rich-text-body>
</ac:structured-macro>`

  // Insert after first heading (H1)
  if (content.match(/^# /m)) {
    // Find first H1 and insert after it
    return content.replace(/^(# .+)$/m, `$1\n\n${warningPanel}`)
  } else {
    // No H1, add at the beginning
    return `${warningPanel}\n\n${content}`
  }
}

module.exports = {
  readFileContent,
  filterContentForFormat,
  extractTitle,
  convertMarkdownToAtlasDoc,
  convertMarkdownToStorage,
  addWarningPanelToAtlas,
  addWarningPanelToContent
}

