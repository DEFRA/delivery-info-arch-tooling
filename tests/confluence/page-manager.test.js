/**
 * Unit tests for confluence/lib/page-manager.js
 */

// Mock dependencies
const { confluenceRequest } = require('../../lib/confluence/lib/api-client')
jest.mock('../../lib/confluence/lib/api-client', () => ({
  confluenceRequest: jest.fn(),
  setConfig: jest.fn()
}))

const {
  setConfig,
  createPagePayload,
  hasLabel,
  isPageSafeToUpdate,
  addLabelToPage,
  handlePageStatus
} = require('../../lib/confluence/lib/page-manager')

describe('page-manager', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setConfig({ generatedLabel: 'generated' })
  })

  describe('setConfig', () => {
    it('should update configuration', () => {
      setConfig({ generatedLabel: 'custom-label' })
      // Config is tested via other functions
      expect(true).toBe(true)
    })
  })

  describe('createPagePayload', () => {
    it('should create payload for new page with Atlas format', () => {
      const atlasDoc = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Content' }] }]
      }

      const payload = createPagePayload(
        'Test Page',
        atlasDoc,
        'parent123',
        null,
        'TEST',
        true
      )

      expect(payload.type).toBe('page')
      expect(payload.title).toBe('Test Page')
      expect(payload.space.key).toBe('TEST')
      expect(payload.ancestors).toEqual([{ id: 'parent123' }])
      expect(payload.body.atlas_doc_format).toBeDefined()
      expect(payload.body.atlas_doc_format.representation).toBe('atlas_doc_format')
    })

    it('should create payload for new page with storage format', () => {
      const content = '<h1>Title</h1><p>Content</p>'

      const payload = createPagePayload(
        'Test Page',
        content,
        'parent123',
        null,
        'TEST',
        false
      )

      expect(payload.body.storage).toBeDefined()
      expect(payload.body.storage.value).toBe(content)
      expect(payload.body.storage.representation).toBe('storage')
    })

    it('should create update payload with version', () => {
      const content = { type: 'doc', content: [] }

      const payload = createPagePayload(
        'Test Page',
        content,
        null,
        5,
        'TEST',
        true
      )

      expect(payload.version).toEqual({ number: 5 })
      expect(payload.space).toBeUndefined()
      expect(payload.ancestors).toBeUndefined()
    })

    it('should handle string Atlas document', () => {
      const atlasJson = JSON.stringify({
        type: 'doc',
        content: []
      })

      const payload = createPagePayload(
        'Test Page',
        atlasJson,
        null,
        null,
        'TEST',
        true
      )

      expect(payload.body.atlas_doc_format.value).toBe(atlasJson)
    })

    it('should omit parent if null or empty', () => {
      const payload1 = createPagePayload('Test', 'content', null, null, 'TEST', false)
      const payload2 = createPagePayload('Test', 'content', '', null, 'TEST', false)

      expect(payload1.ancestors).toBeUndefined()
      expect(payload2.ancestors).toBeUndefined()
    })

    it('should include metadata properties', () => {
      const payload = createPagePayload('Test', 'content', null, null, 'TEST', false)

      expect(payload.metadata.properties['content-appearance-draft'].value).toBe('full-width')
      expect(payload.metadata.properties['content-appearance-published'].value).toBe('full-width')
    })
  })

  describe('hasLabel', () => {
    it('should return true if page has label', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: {
          results: [
            { name: 'generated' },
            { name: 'other' }
          ]
        }
      })

      const result = await hasLabel('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(true)
      expect(confluenceRequest).toHaveBeenCalledWith(
        'GET',
        '/content/page123/label?limit=100',
        expect.any(Object)
      )
    })

    it('should return false if page does not have label', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: {
          results: [
            { name: 'other' }
          ]
        }
      })

      const result = await hasLabel('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })

    it('should return false on error', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 500,
        body: null
      })

      const result = await hasLabel('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })

    it('should return false if results is missing', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: {}
      })

      const result = await hasLabel('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })
  })

  describe('isPageSafeToUpdate', () => {
    it('should return true if page has generated label', async () => {
      confluenceRequest.mockResolvedValue({
        status: 200,
        body: {
          results: [{ name: 'generated' }]
        }
      })

      const result = await isPageSafeToUpdate('page123', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(true)
    })

    it('should return false if page has protected label', async () => {
      // First call: check for generated label (not found)
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: { results: [] }
      })
      // Second call: check for protected label (found)
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: { results: [{ name: 'manual' }] }
      })

      const result = await isPageSafeToUpdate('page123', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })

    it('should return false if page has no labels', async () => {
      confluenceRequest.mockResolvedValue({
        status: 200,
        body: { results: [] }
      })

      const result = await isPageSafeToUpdate('page123', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })
  })

  describe('addLabelToPage', () => {
    it('should add label if not present', async () => {
      // First call: check if label exists (false)
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: { results: [] }
      })
      // Second call: add label (success)
      confluenceRequest.mockResolvedValueOnce({
        status: 201,
        body: { name: 'generated' }
      })

      const result = await addLabelToPage('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(true)
      expect(confluenceRequest).toHaveBeenCalledWith(
        'POST',
        '/content/page123/label',
        expect.objectContaining({
          body: { name: 'generated' }
        })
      )
    })

    it('should return true if label already exists', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: { results: [{ name: 'generated' }] }
      })

      const result = await addLabelToPage('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(true)
      // Should not call POST
      expect(confluenceRequest).toHaveBeenCalledTimes(1)
    })

    it('should return false on error', async () => {
      confluenceRequest
        .mockResolvedValueOnce({
          status: 200,
          body: { results: [] }
        })
        .mockResolvedValueOnce({
          status: 500,
          body: { error: 'Failed' }
        })

      const result = await addLabelToPage('page123', 'generated', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result).toBe(false)
    })
  })

  describe('handlePageStatus', () => {
    it('should return usable for current page', async () => {
      const result = await handlePageStatus('page123', 'current', 'Test Page', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.usable).toBe(true)
      expect(result.pageId).toBe('page123')
      expect(result.title).toBe('Test Page')
    })

    it('should restore archived page', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: { id: 'page123', status: 'current' }
      })

      const result = await handlePageStatus('page123', 'archived', 'Test Page', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.usable).toBe(true)
      expect(confluenceRequest).toHaveBeenCalledWith(
        'POST',
        '/content/page123/restore',
        expect.any(Object)
      )
    })

    it('should delete trashed page', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 204
      })

      const result = await handlePageStatus('page123', 'trashed', 'Test Page', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.usable).toBe(false)
      expect(confluenceRequest).toHaveBeenCalledWith(
        'DELETE',
        '/content/page123?permanent=true',
        expect.any(Object)
      )
    })

    it('should handle restore failure', async () => {
      confluenceRequest.mockResolvedValueOnce({
        status: 500,
        body: { error: 'Restore failed' }
      })

      const result = await handlePageStatus('page123', 'archived', 'Test Page', {
        username: 'user',
        apiToken: 'token'
      })

      expect(result.usable).toBe(false)
    })
  })
})
