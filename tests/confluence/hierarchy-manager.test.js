/**
 * Unit tests for confluence/lib/hierarchy-manager.js
 */

const fs = require('fs')
const apiClient = require('../../lib/confluence/lib/api-client')

jest.mock('../../lib/confluence/lib/api-client', () => ({
  confluenceRequest: jest.fn(),
  getPageByTitle: jest.fn(),
  searchPagesByTitle: jest.fn()
}))

jest.mock('../../lib/confluence/lib/page-manager', () => ({
  createPagePayload: jest.fn(),
  addLabelToPage: jest.fn()
}))

jest.mock('../../lib/confluence/lib/github', () => ({
  getGitHubSourceUrl: jest.fn(() => 'https://github.com/DEFRA/test-repo/tree/main/docs')
}))

const hierarchyManager = require('../../lib/confluence/lib/hierarchy-manager')

describe('hierarchy-manager', () => {
  let readFileSpy

  beforeEach(() => {
    jest.clearAllMocks()
    hierarchyManager.resetCache()
    hierarchyManager.setConfig({ configPath: 'C:/temp/confluence-config.json', dryRun: false })
    readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({
      spaceMapping: {
        Trade: 'TIDIA',
        BTMS: 'BTMS',
        EUDP: 'EUDP'
      }
    }))
  })

  afterEach(() => {
    readFileSpy.mockRestore()
  })

  describe('getSpaceForPath', () => {
    it('should resolve Trade space mapping from Windows-style paths', async () => {
      const result = await hierarchyManager.getSpaceForPath(
        'docs\\Trade\\Delivery Information Architecture\\Technology View\\Current State Views\\System Landscape View.md',
        'C:/temp/confluence-config.json'
      )

      expect(result).toBe('TIDIA')
    })

    it('should resolve system space mapping from Windows-style paths', async () => {
      const result = await hierarchyManager.getSpaceForPath(
        'docs\\systems\\BTMS\\Delivery Passport\\Technology View\\Current State Views\\System Context View.md',
        'C:/temp/confluence-config.json'
      )

      expect(result).toBe('BTMS')
    })
  })

  describe('getParentForPath', () => {
    it('should build folder hierarchy without leaking docs prefixes on Windows paths', async () => {
      const getOrCreateFolderSpy = jest.spyOn(hierarchyManager, 'getOrCreateFolder')
        .mockImplementation(async (folderName, parentId) => {
          return parentId ? `${parentId}/${folderName}` : folderName
        })

      const result = await hierarchyManager.getParentForPath(
        'docs\\Trade\\Delivery Information Architecture\\Technology View\\Current State Views\\System Landscape View.md',
        'TIDIA',
        null,
        { username: 'user', apiToken: 'token' }
      )

      expect(getOrCreateFolderSpy.mock.calls.map(call => call[0])).toEqual([
        'Delivery Information Architecture',
        'Technology View',
        'Current State Views'
      ])

      expect(getOrCreateFolderSpy.mock.calls.map(call => call[3])).toEqual([
        'docs/Trade/Delivery Information Architecture',
        'docs/Trade/Delivery Information Architecture/Technology View',
        'docs/Trade/Delivery Information Architecture/Technology View/Current State Views'
      ])

      expect(result).toBe('Delivery Information Architecture/Technology View/Current State Views')

      getOrCreateFolderSpy.mockRestore()
    })

    it('should not create missing folders during dry run', async () => {
      hierarchyManager.setConfig({ configPath: 'C:/temp/confluence-config.json', dryRun: true })
      apiClient.getPageByTitle.mockResolvedValueOnce({ results: [] })

      const result = await hierarchyManager.getOrCreateFolder(
        'Current State Views',
        'parent-123',
        'TIDIA',
        'docs/Trade/Delivery Information Architecture/Technology View/Current State Views',
        { username: 'user', apiToken: 'token' }
      )

      expect(result).toBe('dryrun:TIDIA:docs/Trade/Delivery Information Architecture/Technology View/Current State Views')
      expect(apiClient.confluenceRequest).not.toHaveBeenCalled()
    })

    it('should not update existing folder pages during dry run', async () => {
      hierarchyManager.setConfig({ configPath: 'C:/temp/confluence-config.json', dryRun: true })
      apiClient.getPageByTitle.mockResolvedValueOnce({
        results: [{ id: 'folder-123', ancestors: [] }]
      })
      apiClient.confluenceRequest.mockResolvedValueOnce({
        status: 200,
        body: {
          body: {
            storage: { value: '<ac:structured-macro ac:name="error"></ac:structured-macro>' },
            atlas_doc_format: { value: '' }
          },
          metadata: { labels: { results: [{ name: 'generated' }] } },
          version: { number: 1 }
        }
      })

      const result = await hierarchyManager.getOrCreateFolder(
        'Current State Views',
        null,
        'TIDIA',
        'docs/Trade/Delivery Information Architecture/Technology View/Current State Views',
        { username: 'user', apiToken: 'token' }
      )

      expect(result).toBe('folder-123')
      expect(apiClient.confluenceRequest).toHaveBeenCalledTimes(1)
      expect(apiClient.confluenceRequest).toHaveBeenCalledWith(
        'GET',
        '/content/folder-123?expand=body.atlas_doc_format,body.storage,version,metadata.labels',
        expect.any(Object)
      )
    })
  })

  describe('updating an existing folder page', () => {
    const folderPath = 'docs/Trade/Delivery Information Architecture'
    const auth = { username: 'user', apiToken: 'token' }

    function existingFolder (body) {
      apiClient.getPageByTitle.mockResolvedValueOnce({ results: [{ id: 'folder-123', ancestors: [] }] })
      apiClient.confluenceRequest.mockResolvedValueOnce({ status: 200, body: { version: { number: 1 }, ...body } })
    }

    it('leaves a native Confluence folder alone', async () => {
      existingFolder({ type: 'folder', body: { atlas_doc_format: { value: '' } } })

      await hierarchyManager.getOrCreateFolder('Delivery Information Architecture', null, 'TIDIA', folderPath, auth)

      expect(apiClient.confluenceRequest).toHaveBeenCalledTimes(1)
    })

    it('leaves a page without the generated label alone', async () => {
      existingFolder({ type: 'page', body: { atlas_doc_format: { value: '' } }, metadata: { labels: { results: [{ name: 'manual' }] } } })

      await hierarchyManager.getOrCreateFolder('Delivery Information Architecture', null, 'TIDIA', folderPath, auth)

      expect(apiClient.confluenceRequest).toHaveBeenCalledTimes(1)
    })

    it('rewrites a generated page that lacks the warning panel, and reports why an update fails', async () => {
      existingFolder({ type: 'page', body: { atlas_doc_format: { value: '' } }, metadata: { labels: { results: [{ name: 'generated' }] } } })
      apiClient.confluenceRequest.mockResolvedValueOnce({ status: 400, body: { message: 'Bad request' } })
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await hierarchyManager.getOrCreateFolder('Delivery Information Architecture', null, 'TIDIA', folderPath, auth)

      expect(apiClient.confluenceRequest).toHaveBeenCalledTimes(2)
      expect(apiClient.confluenceRequest).toHaveBeenLastCalledWith('PUT', '/content/folder-123', expect.any(Object))
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('(HTTP 400): Bad request'))
      errorSpy.mockRestore()
    })
  })
})
