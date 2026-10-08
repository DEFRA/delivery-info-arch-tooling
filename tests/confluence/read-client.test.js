/**
 * Unit tests for confluence/read-client.js
 */

const {
  createClient,
  resolveAuth,
  parsePageId,
  resolveShortLink,
  pageUrl
} = require('../../lib/confluence/read-client')

const AUTH = { username: 'user@defra.gov.uk', apiToken: 'token-123' }

/**
 * Build a minimal fetch Response stub.
 */
function fakeResponse ({ ok = true, status = 200, statusText = 'OK', body = {}, url = '' } = {}) {
  return {
    ok,
    status,
    statusText,
    url,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body))
  }
}

describe('read-client', () => {
  const savedEnv = {}

  beforeEach(() => {
    for (const key of ['CONFLUENCE_USERNAME', 'CONFLUENCE_USER_EMAIL', 'CONFLUENCE_API_TOKEN']) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    global.fetch = jest.fn()
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete global.fetch
  })

  describe('resolveAuth', () => {
    it('should use explicit options first', () => {
      expect(resolveAuth(AUTH)).toEqual(AUTH)
    })

    it('should fall back to environment variables', () => {
      process.env.CONFLUENCE_USERNAME = 'env@defra.gov.uk'
      process.env.CONFLUENCE_API_TOKEN = 'env-token'
      expect(resolveAuth()).toEqual({ username: 'env@defra.gov.uk', apiToken: 'env-token' })
    })

    it('should accept CONFLUENCE_USER_EMAIL as the username', () => {
      process.env.CONFLUENCE_USER_EMAIL = 'email@defra.gov.uk'
      process.env.CONFLUENCE_API_TOKEN = 'env-token'
      expect(resolveAuth().username).toBe('email@defra.gov.uk')
    })

    it('should throw when credentials are missing', () => {
      expect(() => resolveAuth()).toThrow(/Missing credentials/)
      expect(() => resolveAuth({ username: 'only-user' })).toThrow(/CONFLUENCE_API_TOKEN: NOT SET/)
    })
  })

  describe('parsePageId', () => {
    it('should pass through a bare numeric ID', () => {
      expect(parsePageId('123456')).toBe('123456')
      expect(parsePageId(123456)).toBe('123456')
    })

    it('should extract the ID from a spaces URL', () => {
      expect(parsePageId('https://eaflood.atlassian.net/wiki/spaces/EUDP/pages/123456/Some+Title')).toBe('123456')
    })

    it('should extract the ID from a viewpage.action URL', () => {
      expect(parsePageId('https://eaflood.atlassian.net/wiki/pages/viewpage.action?pageId=98765')).toBe('98765')
    })

    it('should extract a pageId query parameter', () => {
      expect(parsePageId('https://eaflood.atlassian.net/wiki/some/path?foo=1&pageId=555')).toBe('555')
    })

    it('should return null for short links and junk', () => {
      expect(parsePageId('https://eaflood.atlassian.net/wiki/x/AbCd12')).toBeNull()
      expect(parsePageId('not a url')).toBeNull()
      expect(parsePageId('')).toBeNull()
      expect(parsePageId(null)).toBeNull()
    })
  })

  describe('pageUrl', () => {
    it('should use the webui link when present', () => {
      const page = { id: '1', _links: { webui: '/spaces/EUDP/pages/1/Title' } }
      expect(pageUrl('https://example.atlassian.net', page))
        .toBe('https://example.atlassian.net/wiki/spaces/EUDP/pages/1/Title')
    })

    it('should fall back to viewpage.action', () => {
      expect(pageUrl('https://example.atlassian.net', { id: '42' }))
        .toBe('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=42')
    })
  })

  describe('createClient', () => {
    it('should normalise the base URL', () => {
      expect(createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net/' }).baseUrl)
        .toBe('https://example.atlassian.net')
      expect(createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net/wiki' }).baseUrl)
        .toBe('https://example.atlassian.net')
    })

    it('should send Basic auth and parse JSON on get', async () => {
      global.fetch.mockResolvedValue(fakeResponse({ body: { id: '123', title: 'Page' } }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      const page = await client.getPage('123')

      expect(page).toEqual({ id: '123', title: 'Page' })
      const [url, options] = global.fetch.mock.calls[0]
      expect(url).toContain('https://example.atlassian.net/wiki/rest/api/content/123')
      expect(options.headers.Authorization)
        .toBe(`Basic ${Buffer.from('user@defra.gov.uk:token-123').toString('base64')}`)
    })

    it('should throw with the API message on non-2xx responses', async () => {
      global.fetch.mockResolvedValue(fakeResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: { message: 'No content found with id: 999' }
      }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      await expect(client.getPage('999')).rejects.toThrow(/404 Not Found[\s\S]*No content found/)
    })

    it('should tolerate non-JSON error bodies', async () => {
      global.fetch.mockResolvedValue(fakeResponse({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        body: '<html>boom</html>'
      }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      await expect(client.getPage('1')).rejects.toThrow(/500 Internal Server Error/)
    })

    it('should follow pagination links in getAll', async () => {
      global.fetch
        .mockResolvedValueOnce(fakeResponse({
          body: { results: [{ id: '1' }, { id: '2' }], _links: { next: '/rest/api/content/1/child/page?start=2' } }
        }))
        .mockResolvedValueOnce(fakeResponse({
          body: { results: [{ id: '3' }] }
        }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      const pages = await client.getChildren('1')

      expect(pages.map(p => p.id)).toEqual(['1', '2', '3'])
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(global.fetch.mock.calls[1][0])
        .toBe('https://example.atlassian.net/wiki/rest/api/content/1/child/page?start=2')
    })

    it('should stop paginating once the limit is reached', async () => {
      global.fetch.mockResolvedValue(fakeResponse({
        body: { results: [{ id: '1' }, { id: '2' }, { id: '3' }], _links: { next: '/rest/api/next' } }
      }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      const pages = await client.getChildren('1', 2)

      expect(pages).toHaveLength(2)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it('should encode CQL queries in search', async () => {
      global.fetch.mockResolvedValue(fakeResponse({ body: { results: [] } }))
      const client = createClient({ ...AUTH, baseUrl: 'https://example.atlassian.net' })

      await client.search('space=EUDP AND text ~ "gateway"')

      expect(global.fetch.mock.calls[0][0])
        .toContain(`cql=${encodeURIComponent('space=EUDP AND text ~ "gateway"')}`)
    })
  })

  describe('resolveShortLink', () => {
    it('should resolve a short link via its redirect target', async () => {
      global.fetch.mockResolvedValue(fakeResponse({
        url: 'https://example.atlassian.net/wiki/spaces/EUDP/pages/424242/Title'
      }))

      const id = await resolveShortLink('https://example.atlassian.net/wiki/x/AbCd12', AUTH)

      expect(id).toBe('424242')
      expect(global.fetch.mock.calls[0][1].redirect).toBe('follow')
    })

    it('should return null when the redirect does not land on a page', async () => {
      global.fetch.mockResolvedValue(fakeResponse({ url: 'https://example.atlassian.net/login' }))

      expect(await resolveShortLink('https://example.atlassian.net/wiki/x/AbCd12', AUTH)).toBeNull()
    })
  })
})
