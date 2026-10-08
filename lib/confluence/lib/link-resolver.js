/**
 * Relative markdown link resolution for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/link-resolver
 *
 * Rewrites links between markdown pages ([text](other-page.md)) to the
 * published Confluence page for the target file. A target that is not in
 * publishPaths, or has no page in Confluence yet, links to its GitHub
 * source instead and logs a warning. Anchors and link titles are dropped:
 * GitHub heading slugs do not match Confluence heading anchors, and the
 * ADF converter does not carry link titles.
 *
 * Supported: inline links, with or without a title, and with or without
 * angle brackets around the URL. Links inside fenced code blocks and
 * inline code spans are left alone, as are image links and escaped
 * brackets. Not supported, and reported with a warning when they point
 * at a relative .md file: reference-style links, link text containing
 * brackets, and indented code blocks (treated as prose, because list
 * continuation lines use the same indentation).
 */

const fs = require('fs').promises
const path = require('path')

// Inline code spans come first so links inside them stay untouched.
// Groups: 1 code ticks, 2 image bang, 3 link text, 4 URL (optionally in <>).
const INLINE_CODE_OR_LINK = /(`+)[\s\S]*?\1|(?<!\\)(!?)\[([^\]]*)\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

// Any URL still in a link position after rewriting: inline (group 2) or a
// reference definition (group 3). Inline code spans match first and are ignored.
const INLINE_CODE_OR_LINK_TARGET = /(`+)[\s\S]*?\1|\]\(\s*<?([^)\s>]+)|^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/g

// Opening or closing code fence: up to three spaces, then three or more ` or ~
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

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
 * Apply a function to every line outside fenced code blocks. A fence
 * closes only on a fence of the same character, at least as long as the
 * opening one, with no info string after it.
 * @param {string} content - Markdown content
 * @param {Function} fn - (line) => replacement line
 * @returns {string} Content with the lines outside code replaced
 */
function mapLinesOutsideFences (content, fn) {
  let openFence = null

  return content.split('\n').map(line => {
    const fenceMatch = line.match(FENCE)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!openFence) {
        openFence = marker
        return line
      }
      if (marker[0] === openFence[0] && marker.length >= openFence.length && !fenceMatch[2].trim()) {
        openFence = null
        return line
      }
    }
    return openFence ? line : fn(line)
  }).join('\n')
}

/**
 * Apply a link transform to every relative markdown link outside code.
 * Image links and escaped brackets are left alone.
 * @param {string} content - Markdown content
 * @param {Function} transform - (url) => replacement URL, or null to keep the link as written
 * @returns {string} Transformed content
 */
function transformLinks (content, transform) {
  return mapLinesOutsideFences(content, line =>
    line.replace(INLINE_CODE_OR_LINK, (match, codeTicks, bang, text, rawUrl) => {
      if (codeTicks || bang) {
        return match
      }
      const url = rawUrl.startsWith('<') ? rawUrl.slice(1, -1) : rawUrl
      if (!isRelativeMarkdownLink(url)) {
        return match
      }
      const replacement = transform(url)
      return replacement ? `[${text}](${replacement})` : match
    })
  )
}

/**
 * List the relative markdown URLs still in a link position, outside code
 * @param {string} content - Markdown content
 * @returns {string[]} URLs
 */
function findRemainingMarkdownLinks (content) {
  const urls = []
  mapLinesOutsideFences(content, line => {
    for (const match of line.matchAll(INLINE_CODE_OR_LINK_TARGET)) {
      const url = match[2] || match[3]
      if (!match[1] && url && isRelativeMarkdownLink(url)) {
        urls.push(url)
      }
    }
    return line
  })
  return urls
}

/**
 * Create a link resolver for one publish run. Successful lookups, and
 * targets that cannot resolve this run (not published, missing, outside
 * the repo), are cached per target file. A target with no page yet is
 * looked up again each time, so a page created earlier in the same run
 * is linked from the pages published after it.
 * @param {Object} options
 * @param {Set<string>} options.publishableFiles - Absolute paths of the files publishPaths publishes
 * @param {Function} options.extractTitle - async (filePath) => page title
 * @param {Function} options.getSpaceForPath - async (filePath) => space key, or null
 * @param {Function} options.findPageId - async (title, spaceKey) => page ID or null; throws when the lookup fails
 * @param {Function} options.getGitHubSourceUrl - (repoRelativePath) => URL or null
 * @param {string} options.confluenceUrl - Confluence base URL
 * @returns {Object} Resolver with rewriteLinks(content, sourceFile)
 */
function createLinkResolver (options) {
  const {
    publishableFiles,
    extractTitle,
    getSpaceForPath,
    findPageId,
    getGitHubSourceUrl,
    confluenceUrl
  } = options

  const cache = new Map()

  function githubFallback (targetPath) {
    const relativePath = path.relative(process.cwd(), targetPath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return null
    }
    return getGitHubSourceUrl(relativePath)
  }

  async function lookUp (targetPath) {
    try {
      await fs.access(targetPath)
    } catch (e) {
      return { url: null, reason: 'target file not found', final: true }
    }
    if (!publishableFiles.has(targetPath)) {
      return { url: null, reason: 'not in publishPaths', final: true }
    }

    const title = await extractTitle(targetPath)
    const spaceKey = await getSpaceForPath(targetPath)
    if (!spaceKey) {
      return { url: null, reason: 'no Confluence space for this path', final: true }
    }

    try {
      const pageId = await findPageId(title, spaceKey)
      return pageId
        ? { url: `${confluenceUrl}/wiki/spaces/${spaceKey}/pages/${pageId}`, final: true }
        : { url: null, reason: `no page titled '${title}' in space ${spaceKey}`, final: false }
    } catch (e) {
      return { url: null, reason: e.message, final: false }
    }
  }

  async function resolveTarget (targetPath) {
    if (cache.has(targetPath)) {
      return cache.get(targetPath)
    }

    const result = await lookUp(targetPath)
    if (!result.url) {
      result.fallback = githubFallback(targetPath)
    }
    if (result.final) {
      cache.set(targetPath, result)
    }
    return result
  }

  /**
   * Rewrite the relative markdown links in content
   * @param {string} content - Markdown content
   * @param {string} sourceFile - Absolute path of the file the content came from
   * @returns {Promise<string>} Content with links rewritten
   */
  async function rewriteLinks (content, sourceFile) {
    const urls = new Set()
    transformLinks(content, (url) => {
      urls.add(url)
      return null
    })

    const resolved = new Map()
    for (const url of urls) {
      const result = await resolveTarget(resolveTargetPath(url, sourceFile))
      if (!result.url) {
        const outcome = result.fallback ? 'linking to GitHub' : 'left unchanged'
        console.error(`    ⚠️  Link not resolved to a Confluence page: ${url} (${result.reason}); ${outcome}`)
      }
      resolved.set(url, result.url || result.fallback || null)
    }

    const rewritten = transformLinks(content, url => resolved.get(url))

    // Links left unchanged on purpose were warned about above; anything else still relative was missed
    for (const url of new Set(findRemainingMarkdownLinks(rewritten))) {
      if (resolved.get(url) !== null) {
        console.error(`    ⚠️  Link not rewritten (unsupported markdown link form): ${url}`)
      }
    }

    return rewritten
  }

  return { rewriteLinks }
}

module.exports = {
  createLinkResolver,
  isRelativeMarkdownLink,
  resolveTargetPath
}
