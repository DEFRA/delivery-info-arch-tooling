/**
 * Relative markdown link resolution for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/link-resolver
 *
 * Rewrites links between markdown pages ([text](other-page.md)) to the
 * published Confluence page for the target file. A target that is not in
 * publishPaths, or has no page in Confluence yet, links to its GitHub
 * source instead and logs a warning. Anchors are dropped: GitHub heading
 * slugs do not match Confluence heading anchors.
 */

const fs = require('fs').promises
const path = require('path')

// Inline code spans are matched first so links inside them stay untouched
const INLINE_CODE_OR_LINK = /(`+)[\s\S]*?\1|(!?)\[([^\]]*)\]\(([^)\s]+)\)/g
const FENCE = /^\s*(```|~~~)/

/**
 * Whether a link URL points at a relative markdown file
 * @param {string} url - Link URL as written in the markdown
 * @returns {boolean}
 */
function isRelativeMarkdownLink (url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) {
    return false
  }
  return /\.md$/i.test(url.split(/[#?]/)[0])
}

/**
 * Resolve a relative link URL to an absolute file path
 * @param {string} url - Relative link URL
 * @param {string} sourceFile - File the link appears in
 * @returns {string} Absolute path of the target file
 */
function resolveTargetPath (url, sourceFile) {
  const linkPath = url.split(/[#?]/)[0]
  let decoded = linkPath
  try {
    decoded = decodeURIComponent(linkPath)
  } catch (e) {
    // Malformed escape sequence: use the path as written
  }
  return path.resolve(path.dirname(sourceFile), decoded)
}

/**
 * Collect the relative markdown link URLs in content, outside code
 * @param {string} content - Markdown content
 * @returns {string[]} Link URLs
 */
function findRelativeMarkdownLinks (content) {
  const urls = []
  transformOutsideCode(content, (url) => {
    urls.push(url)
    return null
  })
  return urls
}

/**
 * Apply a link transform to every relative markdown link outside fenced
 * code blocks and inline code. Image links are left alone.
 * @param {string} content - Markdown content
 * @param {Function} transform - (url) => replacement URL, or null to keep
 * @returns {string} Transformed content
 */
function transformOutsideCode (content, transform) {
  let inFence = false
  let fenceMarker = null

  return content.split('\n').map(line => {
    const fenceMatch = line.match(FENCE)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fenceMarker = fenceMatch[1]
      } else if (fenceMatch[1] === fenceMarker) {
        inFence = false
        fenceMarker = null
      }
      return line
    }
    if (inFence) {
      return line
    }

    return line.replace(INLINE_CODE_OR_LINK, (match, codeTicks, bang, text, url) => {
      if (codeTicks || bang || !isRelativeMarkdownLink(url)) {
        return match
      }
      const replacement = transform(url)
      return replacement ? `[${text}](${replacement})` : match
    })
  }).join('\n')
}

/**
 * Create a link resolver for one publish run. Lookups are cached per
 * target file, so a page linked from many places costs one lookup.
 * @param {Object} options
 * @param {Function} options.getPublishableFiles - async () => Set of absolute paths in publishPaths
 * @param {Function} options.extractTitle - async (filePath) => page title
 * @param {Function} options.getSpaceForPath - async (filePath) => space key
 * @param {Function} options.findPageId - async (title, spaceKey) => page ID or null
 * @param {Function} options.getGitHubSourceUrl - (filePath) => URL or null
 * @param {string} options.confluenceUrl - Confluence base URL
 * @returns {Object} Resolver with rewriteLinks(content, sourceFile)
 */
function createLinkResolver (options) {
  const {
    getPublishableFiles,
    extractTitle,
    getSpaceForPath,
    findPageId,
    getGitHubSourceUrl,
    confluenceUrl
  } = options

  const cache = new Map()

  async function resolveTarget (targetPath) {
    if (cache.has(targetPath)) {
      return cache.get(targetPath)
    }

    let result
    try {
      await fs.access(targetPath)
      const publishable = await getPublishableFiles()
      if (!publishable.has(targetPath)) {
        result = { url: null, reason: 'not in publishPaths' }
      } else {
        const title = await extractTitle(targetPath)
        const spaceKey = await getSpaceForPath(targetPath)
        const pageId = spaceKey ? await findPageId(title, spaceKey) : null
        result = pageId
          ? { url: `${confluenceUrl}/wiki/spaces/${spaceKey}/pages/${pageId}` }
          : { url: null, reason: `no page titled '${title}' in space ${spaceKey || '(none)'}` }
      }
    } catch (e) {
      result = { url: null, reason: e.code === 'ENOENT' ? 'target file not found' : e.message }
    }

    if (!result.url) {
      result.fallback = getGitHubSourceUrl(path.relative(process.cwd(), targetPath))
    }

    cache.set(targetPath, result)
    return result
  }

  /**
   * Rewrite the relative markdown links in content
   * @param {string} content - Markdown content
   * @param {string} sourceFile - File the content came from
   * @returns {Promise<string>} Content with links rewritten
   */
  async function rewriteLinks (content, sourceFile) {
    const urls = findRelativeMarkdownLinks(content)
    if (urls.length === 0) {
      return content
    }

    const resolved = new Map()
    for (const url of new Set(urls)) {
      const result = await resolveTarget(resolveTargetPath(url, sourceFile))
      if (!result.url) {
        const target = result.fallback ? 'linking to GitHub' : 'left unchanged'
        console.error(`    ⚠️  Link not resolved to a Confluence page: ${url} (${result.reason}); ${target}`)
      }
      resolved.set(url, result.url || result.fallback || null)
    }

    return transformOutsideCode(content, url => resolved.get(url))
  }

  return { rewriteLinks }
}

module.exports = {
  createLinkResolver,
  isRelativeMarkdownLink,
  resolveTargetPath
}
