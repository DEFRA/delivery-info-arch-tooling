/**
 * Diagram resolution for PDF export
 * @module @defra/delivery-info-arch-tooling/pdf/diagrams
 *
 * Replaces `<MermaidDiagram diagramId="…" />` and `<LikeC4View viewId="…" />`
 * component tags with a markdown image pointing at the pre-rendered diagram,
 * so md-to-pdf embeds it. Image paths are written relative to the markdown
 * file, so the PDF exporter must serve the repository root (see basedir).
 */

const fs = require('fs')
const path = require('path')

const IMAGE_EXTENSIONS = ['.png', '.svg']

// Where rendered diagrams live, in priority order (relative to rootDir)
const IMAGE_DIRS = [
  ['generated', 'diagrams'],
  ['build', 'mmd'],
  ['astro', 'likec4-exports'],
  ['architecture', 'export']
]

const MERMAID_TAG = /<MermaidDiagram\b[^>]*\bdiagramId="([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/MermaidDiagram>)/g
const LIKEC4_TAG = /<LikeC4View\b[^>]*\bviewId="([^"]+)"[^>]*(?:\/>|>[\s\S]*?<\/LikeC4View>)/g

/**
 * Recursively search a directory for a file by name
 * @param {string} dir - Directory to search
 * @param {string} filename - File name to find
 * @returns {string|null} Absolute path or null
 */
function findFileRecursive (dir, filename) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    return null
  }
  // Files first so a flat match wins over a nested one
  for (const entry of entries) {
    if (entry.isFile() && entry.name === filename) {
      return path.join(dir, entry.name)
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileRecursive(path.join(dir, entry.name), filename)
      if (found) {
        return found
      }
    }
  }
  return null
}

/**
 * Find the rendered image for a diagram ID
 * @param {string} diagramId - Diagram or view ID (the file basename)
 * @param {string} rootDir - Repository root
 * @returns {string|null} Absolute image path or null
 */
function findDiagramImage (diagramId, rootDir) {
  for (const segments of IMAGE_DIRS) {
    const dir = path.join(rootDir, ...segments)
    for (const ext of IMAGE_EXTENSIONS) {
      const found = findFileRecursive(dir, `${diagramId}${ext}`)
      if (found) {
        return found
      }
    }
  }
  return null
}

/**
 * Relative URL from the markdown file's directory to an image
 * @param {string} fromDir - Directory of the markdown file
 * @param {string} imagePath - Absolute image path
 * @returns {string} Forward-slash relative path
 */
function toRelativeUrl (fromDir, imagePath) {
  return path.relative(fromDir, imagePath).split(path.sep).join('/')
}

/**
 * Replace diagram component tags with markdown images for PDF rendering
 * @param {string} markdown - Markdown content
 * @param {Object} options - Options
 * @param {string} options.inputPath - Absolute path of the markdown file (image paths are made relative to its directory)
 * @param {string} [options.rootDir] - Repository root (default: process.cwd())
 * @param {Function} [options.log] - Logger for warnings (default: console.error)
 * @returns {string} Markdown with tags resolved
 */
function resolveDiagramTags (markdown, options) {
  const { inputPath, rootDir = process.cwd(), log = console.error } = options
  const inputDir = path.dirname(inputPath)

  const replaceTag = (kind, id) => {
    const imagePath = findDiagramImage(id, rootDir)
    if (!imagePath) {
      log(`    ⚠️  ${kind} image not found for '${id}' - run npm run build:mmd or build:diagrams`)
      return `*Diagram '${id}' not found*`
    }
    return `![${id}](${toRelativeUrl(inputDir, imagePath)})`
  }

  return markdown
    .replace(MERMAID_TAG, (match, id) => replaceTag('Mermaid diagram', id))
    .replace(LIKEC4_TAG, (match, id) => replaceTag('LikeC4 view', id))
}

module.exports = {
  resolveDiagramTags,
  findDiagramImage
}
