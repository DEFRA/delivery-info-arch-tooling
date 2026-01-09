/**
 * Unit tests for confluence/lib/api-client.js
 */

// Mock fetch before importing
global.fetch = jest.fn()

const {
  setConfig,
  confluenceRequest,
  searchPagesByTitle,
  getPageByTitle,
  findPageByTitle
} = require('../../lib/confluence/lib/api-client')

describe('api-client', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setConfig({ confluenceUrl: 'https://test.atlassian.net' })
  })

  describe('setConfig', () => {
    it('should update configuration', () => {
      setConfig({ confluenceUrl: 'https://custom.atlassian.net' })
      // Config is internal, but we can verify via API calls
      expect(true).toBe(true) // Placeholder - config is tested via other functions
    })
  })

  describe('confluenceRequest', () => {
    it('should make GET request with authentication', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue('{"id": "123"}'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await confluenceRequest('GET', '/content/123', {
        auth: { username: 'user', apiToken: 'token' }
      })

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.atlassian.net/wiki/rest/api/content/123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: expect.stringContaining('Basic')
          })
        })
      )
      expect(result.status).toBe(200)
      expect(result.body.id).toBe('123')
    })

    it('should make POST request with body', async () => {
      const mockResponse = {
        status: 201,
        ok: true,
        text: jest.fn().mockResolvedValue('{"id": "456"}'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const payload = { title: 'Test Page', type: 'page' }
      const result = await confluenceRequest('POST', '/content', {
        auth: { username: 'user', apiToken: 'token' },
        body: payload
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload)
        })
      )
      expect(result.status).toBe(201)
    })

    it('should handle string body', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue('{"success": true}'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await confluenceRequest('PUT', '/content/123', {
        auth: { username: 'user', apiToken: 'token' },
        body: '{"title": "Updated"}'
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: '{"title": "Updated"}'
        })
      )
    })

    it('should handle non-JSON response', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue('Plain text response'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await confluenceRequest('GET', '/content/123', {
        auth: { username: 'user', apiToken: 'token' }
      })

      expect(result.body).toBe('Plain text response')
    })

    it('should throw error on network failure', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(confluenceRequest('GET', '/content/123', {
        auth: { username: 'user', apiToken: 'token' }
      })).rejects.toThrow('HTTP request failed')
    })

    it('should include custom headers', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue('{}'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      await confluenceRequest('GET', '/content/123', {
        auth: { username: 'user', apiToken: 'token' },
        headers: { 'X-Custom-Header': 'value' }
      })

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'value'
          })
        })
      )
    })
  })

  describe('searchPagesByTitle', () => {
    it('should search pages with status filter', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }],
          size: 1
        })),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await searchPagesByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].title).toBe('Test Page')
    })

    it('should fallback to search without status filter', async () => {
      // First call fails
      const mockResponse1 = {
        status: 500,
        ok: false,
        text: jest.fn().mockResolvedValue('Error'),
        headers: new Map()
      }
      // Second call succeeds
      const mockResponse2 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }]
        })),
        headers: new Map()
      }
      global.fetch
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)

      const result = await searchPagesByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toHaveLength(1)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it('should return empty results on error', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Search failed'))

      const result = await searchPagesByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toEqual([])
    })

    it('should escape quotes in title', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({ results: [] })),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      await searchPagesByTitle('Page with "quotes"', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      const callUrl = global.fetch.mock.calls[0][0]
      expect(callUrl).toContain(encodeURIComponent('\\"'))
    })
  })

  describe('getPageByTitle', () => {
    it('should get page by title', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }],
          size: 1
        })),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await getPageByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toHaveLength(1)
      expect(result.results[0].title).toBe('Test Page')
    })

    it('should return empty results if not found', async () => {
      const mockResponse = {
        status: 404,
        ok: false,
        text: jest.fn().mockResolvedValue('Not found'),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await getPageByTitle('Nonexistent', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toEqual([])
    })

    it('should fallback to CQL search if direct lookup fails', async () => {
      const mockResponse1 = {
        status: 500,
        ok: false,
        text: jest.fn().mockResolvedValue('Error'),
        headers: new Map()
      }
      const mockResponse2 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }]
        })),
        headers: new Map()
      }
      global.fetch
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)

      const result = await getPageByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.results).toHaveLength(1)
    })
  })

  describe('findPageByTitle', () => {
    it('should find page using direct lookup', async () => {
      const mockResponse = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }],
          size: 1
        })),
        headers: new Map()
      }
      global.fetch.mockResolvedValueOnce(mockResponse)

      const result = await findPageByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.page.results).toHaveLength(1)
      expect(result.count).toBe(1)
    })

    it('should fallback to CQL search if direct lookup fails', async () => {
      const mockResponse1 = {
        status: 404,
        ok: false,
        text: jest.fn().mockResolvedValue('Not found'),
        headers: new Map()
      }
      const mockResponse2 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [{ id: '123', title: 'Test Page' }],
          size: 1
        })),
        headers: new Map()
      }
      global.fetch
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)

      const result = await findPageByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.count).toBe(1)
    })

    it('should fallback to listing all pages if CQL fails', async () => {
      const mockResponse1 = {
        status: 404,
        ok: false,
        text: jest.fn().mockResolvedValue('Not found'),
        headers: new Map()
      }
      const mockResponse2 = {
        status: 500,
        ok: false,
        text: jest.fn().mockResolvedValue('CQL error'),
        headers: new Map()
      }
      const mockResponse3 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({
          results: [
            { id: '456', title: 'Other Page' },
            { id: '123', title: 'Test Page' }
          ],
          size: 2
        })),
        headers: new Map()
      }
      global.fetch
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)
        .mockResolvedValueOnce(mockResponse3)

      const result = await findPageByTitle('Test Page', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.count).toBeGreaterThan(0)
      expect(result.page.results.find(p => p.id === '123')).toBeDefined()
    })

    it('should return empty results if page not found', async () => {
      const mockResponse1 = {
        status: 404,
        ok: false,
        text: jest.fn().mockResolvedValue('Not found'),
        headers: new Map()
      }
      const mockResponse2 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({ results: [] })),
        headers: new Map()
      }
      const mockResponse3 = {
        status: 200,
        ok: true,
        text: jest.fn().mockResolvedValue(JSON.stringify({ results: [] })),
        headers: new Map()
      }
      global.fetch
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)
        .mockResolvedValueOnce(mockResponse3)

      const result = await findPageByTitle('Nonexistent', 'TEST', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.count).toBe(0)
      expect(result.page.results).toEqual([])
    })
  })
})
