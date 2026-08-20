/**
 * Read-side Confluence client.
 *
 * Mirrors the auth and endpoint conventions of `api-client.js` (Basic auth
 * against `/wiki/rest/api`) but is concerned only with reading: fetching
 * pages, walking hierarchies and searching.
 *
 * @module @defra/delivery-info-arch-tooling/confluence/read-client
 */

const DEFAULT_BASE_URL = process.env.CONFLUENCE_URL || 'https://eaflood.atlassian.net'
const PAGE_EXPAND = 'body.storage,version,space,ancestors,metadata.labels,history.lastUpdated'

/**
 * Build the Basic auth header value from credentials.
 * @param {Object} auth - Credentials
 * @param {string} auth.username - Atlassian account email
 * @param {string} auth.apiToken - Atlassian API token
 * @returns {string} Authorization header value
 */
function basicAuth ({ username, apiToken }) {
  return `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}`
}

/**
 * Resolve credentials from explicit options then environment.
 * @param {Object} [options] - Overrides
 * @returns {{username: string, apiToken: string}} Credentials
 * @throws {Error} When either credential is missing
 */
function resolveAuth (options = {}) {
  const username = options.username || process.env.CONFLUENCE_USERNAME || process.env.CONFLUENCE_USER_EMAIL
  const apiToken = options.apiToken || process.env.CONFLUENCE_API_TOKEN

  if (!username || !apiToken) {
    throw new Error(
      'Missing credentials. Set CONFLUENCE_USERNAME and CONFLUENCE_API_TOKEN:\n' +
      '  export CONFLUENCE_USERNAME="your-email@defra.gov.uk"\n' +
      '  export CONFLUENCE_API_TOKEN="your-api-token"\n' +
      `  (CONFLUENCE_USERNAME: ${username ? 'SET' : 'NOT SET'}, CONFLUENCE_API_TOKEN: ${apiToken ? 'SET' : 'NOT SET'})`
    )
  }
  return { username, apiToken }
}

/**
 * Create a client bound to a base URL and credentials.
 * @param {Object} [options] - Client options
 * @param {string} [options.baseUrl] - Confluence base URL, without /wiki
 * @param {string} [options.username] - Atlassian account email
 * @param {string} [options.apiToken] - Atlassian API token
 * @returns {Object} Client with request helpers
 */
function createClient (options = {}) {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/wiki$/, '')
  const auth = resolveAuth(options)

  /**
   * Issue a GET against the Confluence REST API.
   * @param {string} endpoint - Endpoint below /wiki/rest/api
   * @returns {Promise<Object>} Parsed JSON body
   * @throws {Error} On non-2xx responses, with the API's own message
   */
  async function get (endpoint) {
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}/wiki/rest/api${endpoint}`
    const response = await fetch(url, {
      headers: {
        Authorization: basicAuth(auth),
        Accept: 'application/json'
      }
    })

    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch (e) {
      body = text
    }

    if (!response.ok) {
      const detail = (body && body.message) || (typeof body === 'string' ? body.slice(0, 300) : '')
      throw new Error(`${response.status} ${response.statusText} for ${url}${detail ? `\n  ${detail}` : ''}`)
    }
    return body
  }

  /**
   * Follow a paginated collection endpoint to the end.
   * @param {string} endpoint - Endpoint below /wiki/rest/api
   * @param {number} [max] - Stop once this many results are collected
   * @returns {Promise<Array<Object>>} Collected results
   */
  async function getAll (endpoint, max = Infinity) {
    const results = []
    let next = endpoint
    while (next && results.length < max) {
      const body = await get(next)
      results.push(...(body.results || []))
      const link = body._links && body._links.next
      next = link ? `${baseUrl}/wiki${link}` : null
    }
    return results.slice(0, max === Infinity ? undefined : max)
  }

  return {
    baseUrl,
    get,
    getAll,

    /**
     * Fetch a single page with its storage body.
     * @param {string} id - Page ID
     * @returns {Promise<Object>} Page object
     */
    getPage: id => get(`/content/${encodeURIComponent(id)}?expand=${PAGE_EXPAND}`),

    /**
     * List the immediate child pages of a page.
     * @param {string} id - Page ID
     * @param {number} [limit] - Maximum children
     * @returns {Promise<Array<Object>>} Child pages
     */
    getChildren: (id, limit = 200) =>
      getAll(`/content/${encodeURIComponent(id)}/child/page?expand=version,space&limit=100`, limit),

    /**
     * List every descendant page beneath a page.
     * @param {string} id - Page ID
     * @param {number} [limit] - Maximum descendants
     * @returns {Promise<Array<Object>>} Descendant pages
     */
    getDescendants: (id, limit = 1000) =>
      getAll(`/content/${encodeURIComponent(id)}/descendant/page?expand=version,space,ancestors&limit=100`, limit),

    /**
     * List the pages in a space.
     * @param {string} spaceKey - Space key
     * @param {number} [limit] - Maximum pages
     * @returns {Promise<Array<Object>>} Pages
     */
    getSpacePages: (spaceKey, limit = 1000) =>
      getAll(`/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&expand=version,space,ancestors&limit=100`, limit),

    /**
     * List spaces visible to the credentials.
     * @param {number} [limit] - Maximum spaces
     * @returns {Promise<Array<Object>>} Spaces
     */
    getSpaces: (limit = 500) => getAll('/space?limit=100', limit),

    /**
     * Run a CQL search.
     * @param {string} cql - CQL query
     * @param {number} [limit] - Maximum results
     * @returns {Promise<Array<Object>>} Matching content
     */
    search: (cql, limit = 50) =>
      getAll(`/content/search?cql=${encodeURIComponent(cql)}&expand=version,space&limit=50`, limit),

    /**
     * Confirm the credentials work and report the account they belong to.
     * @returns {Promise<Object>} Current user
     */
    whoami: () => get('/user/current')
  }
}

/**
 * Extract a page ID from a Confluence URL, or pass through a bare ID.
 *
 * Handles `/wiki/spaces/KEY/pages/123/Title`, `?pageId=123`, `/pages/viewpage.action?pageId=123`
 * and bare numeric IDs. Short `/wiki/x/AbCd` links are resolved by the caller.
 *
 * @param {string} input - URL or ID
 * @returns {string|null} Page ID, or null when the input is a short link
 */
function parsePageId (input) {
  const value = String(input || '').trim()
  if (/^\d+$/.test(value)) return value

  const pagesPath = value.match(/\/pages\/(?:viewpage\.action\?pageId=)?(\d+)/)
  if (pagesPath) return pagesPath[1]

  const queryParam = value.match(/[?&]pageId=(\d+)/)
  if (queryParam) return queryParam[1]

  return null
}

/**
 * Resolve a short `/wiki/x/...` link to a page ID by following the redirect.
 * @param {string} url - Short URL
 * @param {Object} auth - Credentials
 * @returns {Promise<string|null>} Page ID, or null when it cannot be resolved
 */
async function resolveShortLink (url, auth) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { Authorization: basicAuth(auth) }
  })
  return parsePageId(response.url)
}

/**
 * Build the human-facing URL for a page.
 * @param {string} baseUrl - Confluence base URL
 * @param {Object} page - Page object
 * @returns {string} Page URL
 */
function pageUrl (baseUrl, page) {
  const webui = page._links && page._links.webui
  return webui ? `${baseUrl}/wiki${webui}` : `${baseUrl}/wiki/pages/viewpage.action?pageId=${page.id}`
}

module.exports = {
  createClient,
  resolveAuth,
  parsePageId,
  resolveShortLink,
  pageUrl,
  DEFAULT_BASE_URL
}
