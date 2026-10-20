/**
 * Post-publish link verification for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/link-verifier
 *
 * Reads each page a run published, as Confluence stores it, and checks
 * every link on the page:
 *
 * - an anchor within the page must name a heading on that page;
 * - a link to a Confluence page must reach a page that exists, and its
 *   anchor, if any, must name a heading on that page;
 * - a link to a markdown file in the page's own GitHub repository is
 *   broken, because a link between published pages should land on the
 *   Confluence page; the page's own source link, in the generated-page
 *   banner, is the one exception;
 * - any other http(s) link is requested, and one that does not answer
 *   with a success or a redirect is reported as unreachable. An external
 *   site can refuse an anonymous request that a signed-in reader passes,
 *   so an unreachable link is a warning, not a failure.
 */

const { confluenceAnchor } = require('./link-resolver')

/**
 * Every link URL in an ADF document: link marks and smart-link cards
 * @param {Object} adf - Atlas document
 * @returns {string[]} URLs, in document order, without duplicates
 */
function collectLinks (adf) {
  const urls = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }
    for (const mark of node.marks || []) {
      if (mark.type === 'link' && mark.attrs && mark.attrs.href) {
        urls.push(mark.attrs.href)
      }
    }
    if (['inlineCard', 'blockCard', 'embedCard'].includes(node.type) && node.attrs && node.attrs.url) {
      urls.push(node.attrs.url)
    }
    for (const child of node.content || []) {
      visit(child)
    }
  }
  visit(adf)
  return [...new Set(urls)]
}

/**
 * The Confluence anchor of every heading in an ADF document
 * @param {Object} adf - Atlas document
 * @returns {Set<string>}
 */
function headingAnchorsOfAdf (adf) {
  const anchors = new Set()
  const textOf = (node) => (node.text || '') + (node.content || []).map(textOf).join('')
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (node.type === 'heading') {
      anchors.add(confluenceAnchor(textOf(node).trim()))
    }
    for (const child of node.content || []) {
      visit(child)
    }
  }
  visit(adf)
  return anchors
}

function decode (text) {
  try {
    return decodeURIComponent(text)
  } catch (e) {
    return text
  }
}

function escapeRegExp (text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The repository prefix of a GitHub blob URL, up to and including the branch
 * @param {string} url - GitHub blob URL
 * @returns {string|null}
 */
function githubRepoBlobPrefix (url) {
  const match = url && url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/)/)
  return match ? match[1] : null
}

/**
 * Create a verifier for one publish run. Page reads and external checks
 * are cached for the run.
 * @param {Object} options
 * @param {string} options.confluenceUrl - Confluence base URL
 * @param {Function} options.fetchPage - async (pageId) => { title, adf } or null when no page has that ID; throws when the read fails
 * @param {Function} options.checkExternal - async (url) => { ok, status }
 * @returns {Object} Verifier with verify(pages)
 */
function createLinkVerifier (options) {
  const { confluenceUrl, fetchPage, checkExternal } = options
  const pageUrl = new RegExp(`^${escapeRegExp(confluenceUrl.replace(/\/$/, ''))}/wiki/spaces/[^/]+/pages/(\\d+)(?:/[^?#]*)?(?:\\?[^#]*)?(?:#(.*))?$`)
  const pages = new Map()
  const external = new Map()

  async function readPage (pageId) {
    if (!pages.has(pageId)) {
      pages.set(pageId, fetchPage(pageId).then(
        (page) => page ? { ...page, anchors: headingAnchorsOfAdf(page.adf) } : null,
        (error) => ({ error: error.message })
      ))
    }
    return pages.get(pageId)
  }

  async function reach (url) {
    if (!external.has(url)) {
      external.set(url, checkExternal(url).catch((error) => ({ ok: false, status: error.message })))
    }
    return external.get(url)
  }

  /**
   * Check every link on each published page
   * @param {Array<{id: string, sourceUrl: string|null}>} published - Pages the run published
   * @returns {Promise<Object>} { pages, links, broken: [{page, href, reason}], unreachable: [{page, href, reason}] }
   */
  async function verify (published) {
    const result = { pages: 0, links: 0, broken: [], unreachable: [] }

    for (const { id, sourceUrl } of published) {
      const page = await readPage(id)
      if (!page || page.error) {
        result.broken.push({ page: id, href: '(page)', reason: page ? `could not read the published page: ${page.error}` : 'the published page was not found' })
        continue
      }
      result.pages++
      const repoPrefix = githubRepoBlobPrefix(sourceUrl)

      for (const href of collectLinks(page.adf)) {
        result.links++
        const broken = (reason) => result.broken.push({ page: page.title, href, reason })

        if (href.startsWith('#')) {
          if (!page.anchors.has(decode(href.slice(1)))) {
            broken('no heading on this page has that anchor')
          }
          continue
        }

        const confluenceLink = href.match(pageUrl)
        if (confluenceLink) {
          const target = await readPage(confluenceLink[1])
          if (!target) {
            broken(`no Confluence page has ID ${confluenceLink[1]}`)
          } else if (target.error) {
            broken(`could not read the target page: ${target.error}`)
          } else if (confluenceLink[2] && !target.anchors.has(decode(confluenceLink[2]))) {
            broken(`no heading on '${target.title}' has that anchor`)
          }
          continue
        }

        if (href === sourceUrl) {
          continue
        }
        if (repoPrefix && href.startsWith(repoPrefix) && /\.md(#|\?|$)/i.test(href)) {
          broken('links to a markdown source on GitHub instead of its Confluence page')
          continue
        }

        if (/^https?:\/\//i.test(href)) {
          const outcome = await reach(href)
          if (!outcome.ok) {
            result.unreachable.push({ page: page.title, href, reason: String(outcome.status) })
          }
        }
      }
    }

    return result
  }

  return { verify }
}

/**
 * Request an external URL: HEAD first, then GET when the server refuses HEAD
 * @param {string} url - URL to check
 * @param {number} [timeoutMs=10000] - Time limit per request
 * @returns {Promise<{ok: boolean, status: number|string}>}
 */
async function checkExternalUrl (url, timeoutMs = 10000) {
  const attempt = (method) => globalThis.fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  let response = await attempt('HEAD')
  if (response.status === 405 || response.status === 501) {
    response = await attempt('GET')
  }
  return { ok: response.status < 400, status: response.status }
}

module.exports = {
  createLinkVerifier,
  checkExternalUrl,
  collectLinks,
  headingAnchorsOfAdf
}
