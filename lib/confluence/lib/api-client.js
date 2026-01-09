/**
 * Confluence API client functions
 * @module @defra/delivery-info-arch-tooling/confluence/api-client
 */

const { getJsonResultCount, toNumeric } = require('./utils')

// Use Node.js built-in fetch (Node 18+)
let fetch
try {
  fetch = globalThis.fetch
} catch (e) {
  console.error('❌ Error: fetch is not available. Please use Node.js 18+')
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
 * Make HTTP request to Confluence API
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Response object with status, ok, body, headers
 */
async function confluenceRequest (method, endpoint, options = {}) {
  const { username, apiToken } = options.auth || {}
  const url = `${CONFIG.confluenceUrl}/wiki/rest/api${endpoint}`

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Basic ${Buffer.from(`${username}:${apiToken}`).toString('base64')}`,
    ...options.headers
  }

  const fetchOptions = {
    method,
    headers
  }

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body)
  }

  try {
    const response = await fetch(url, fetchOptions)
    const text = await response.text()
    let body

    try {
      body = JSON.parse(text)
    } catch (e) {
      body = text
    }

    return {
      status: response.status,
      ok: response.ok,
      body,
      headers: response.headers
    }
  } catch (error) {
    throw new Error(`HTTP request failed: ${error.message}`)
  }
}

/**
 * Search pages by title using CQL (Confluence Query Language)
 * Returns JSON response with results
 * @param {string} title - Page title to search for
 * @param {string} spaceKey - Confluence space key
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object>} Search results
 */
async function searchPagesByTitle (title, spaceKey, auth) {
  const escapedTitle = title.replace(/"/g, '\\"')

  // Try with status filter first (current and archived)
  let cqlQuery = `space=${spaceKey} AND title="${escapedTitle}" AND (status=current OR status=archived)`
  let encodedCql = encodeURIComponent(cqlQuery)

  try {
    const response = await confluenceRequest('GET',
      `/content/search?cql=${encodedCql}&expand=version,body.storage,ancestors,metadata.labels`,
      { auth }
    )

    if (response.status === 200 && response.body && typeof response.body === 'object') {
      const resultCount = getJsonResultCount(response.body)
      if (resultCount > 0) {
        return response.body
      }
    }
  } catch (error) {
    console.error(`    🔍 CQL search with status filter failed: ${error.message}`)
  }

  // Fallback: try search without status filter
  cqlQuery = `space=${spaceKey} AND title="${escapedTitle}"`
  encodedCql = encodeURIComponent(cqlQuery)

  try {
    const response = await confluenceRequest('GET',
      `/content/search?cql=${encodedCql}&expand=version,body.storage,ancestors,metadata.labels`,
      { auth }
    )

    if (response.status === 200 && response.body && typeof response.body === 'object') {
      return response.body
    }
  } catch (error) {
    console.error(`    🔍 CQL search without status filter failed: ${error.message}`)
  }

  // Return empty results on error
  return { results: [] }
}

/**
 * Get page by title (direct lookup)
 * @param {string} title - Page title
 * @param {string} spaceKey - Confluence space key
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object>} Page data
 */
async function getPageByTitle (title, spaceKey, auth) {
  const encodedTitle = encodeURIComponent(title)

  try {
    const response = await confluenceRequest('GET',
      `/content?spaceKey=${spaceKey}&title=${encodedTitle}&expand=version,body.storage,ancestors`,
      { auth }
    )

    if (response.status === 200 && response.body && typeof response.body === 'object') {
      const resultCount = getJsonResultCount(response.body)
      if (resultCount > 0) {
        return response.body
      }
    }
  } catch (error) {
    console.error(`    🔍 Direct lookup failed: ${error.message}`)
  }

  // If direct lookup failed, try CQL search as fallback
  const cqlResult = await searchPagesByTitle(title, spaceKey, auth)
  const resultCount = getJsonResultCount(cqlResult)
  if (resultCount > 0) {
    return cqlResult
  }

  // No page found
  return { results: [] }
}

/**
 * Find page by title with multiple fallback strategies
 * Returns object with { page: JSON, count: number }
 * @param {string} title - Page title
 * @param {string} spaceKey - Confluence space key
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object>} Object with page data and count
 */
async function findPageByTitle (title, spaceKey, auth) {
  let existingPage = null
  let resultCount = 0

  // Try direct lookup first
  const encodedTitle = encodeURIComponent(title)
  try {
    const response = await confluenceRequest('GET',
      `/content?spaceKey=${spaceKey}&title=${encodedTitle}&expand=version,body.storage,ancestors`,
      { auth }
    )

    if (response.status === 200 && response.body && typeof response.body === 'object') {
      resultCount = getJsonResultCount(response.body)
      if (resultCount > 0) {
        existingPage = response.body
        console.error(`    🔍 Direct lookup found ${resultCount} result(s)`)
      }
    }
  } catch (error) {
    // Continue to fallback
  }

  // If direct lookup failed, try CQL search
  if (resultCount === 0) {
    console.error('    🔍 Trying CQL search (including archived)...')
    existingPage = await searchPagesByTitle(title, spaceKey, auth)
    resultCount = getJsonResultCount(existingPage)
    if (resultCount > 0) {
      console.error(`    🔍 CQL search found ${resultCount} result(s)`)
    }
  }

  // Fallback: list all pages and filter by title (with pagination if needed)
  if (resultCount === 0) {
    console.error('    🔍 Trying fallback: list all pages in space and filter by title...')
    let start = 0
    const limit = 500
    let hasMore = true

    while (hasMore) {
      try {
        const response = await confluenceRequest('GET',
          `/content?spaceKey=${spaceKey}&start=${start}&limit=${limit}&expand=version,ancestors`,
          { auth }
        )

        if (response.status === 200 && response.body && typeof response.body === 'object') {
          // Check if we found the page
          const matchedPage = response.body.results?.find(p => p.title === title)
          if (matchedPage) {
            console.error(`    ✅ Found page by listing all pages: ${matchedPage.id}`)
            existingPage = { results: [matchedPage] }
            resultCount = 1
            break
          }

          // Check if there are more pages to fetch
          const currentSize = response.body.results?.length || 0
          if (currentSize < limit || start >= 10000) {
            hasMore = false
          } else {
            start += limit
          }
        } else {
          hasMore = false
        }
      } catch (error) {
        console.error(`    ⚠️  Error when listing pages: ${error.message}`)
        hasMore = false
      }
    }
  }

  // Ensure resultCount is numeric
  resultCount = toNumeric(resultCount)

  // Validate that existingPage is valid JSON
  if (existingPage && (!existingPage.results || !Array.isArray(existingPage.results))) {
    console.error('    ⚠️  Warning: Search returned invalid JSON, treating as no results')
    existingPage = { results: [] }
    resultCount = 0
  }

  return {
    page: existingPage || { results: [] },
    count: resultCount
  }
}

/**
 * Extract page ID from search results
 * @param {Object} searchResult - Search result object
 * @param {number} resultCount - Number of results
 * @param {string} parentId - Optional parent page ID
 * @returns {string|null} Page ID or null
 */
function extractPageIdFromResults (searchResult, resultCount, parentId = null) {
  if (!searchResult || !searchResult.results || resultCount === 0) {
    return null
  }

  if (resultCount === 1) {
    return searchResult.results[0].id || null
  }

  // Multiple results - find one matching parent if provided
  if (parentId) {
    for (const page of searchResult.results) {
      const ancestors = page.ancestors || []
      const lastAncestor = ancestors[ancestors.length - 1]
      if (lastAncestor && lastAncestor.id === parentId) {
        return page.id
      }
    }
  }

  // Return first result if no parent match or no parent specified
  return searchResult.results[0].id || null
}

module.exports = {
  setConfig,
  confluenceRequest,
  searchPagesByTitle,
  getPageByTitle,
  findPageByTitle,
  extractPageIdFromResults
}

