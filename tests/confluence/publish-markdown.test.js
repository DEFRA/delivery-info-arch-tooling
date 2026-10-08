/**
 * Unit tests for publishing one markdown page through confluence/index.js
 */

const fs = require('fs')

jest.mock('../../lib/confluence/lib/api-client', () => ({
  setConfig: jest.fn(),
  findPageByTitle: jest.fn(),
  findCurrentPageId: jest.fn(),
  confluenceRequest: jest.fn()
}))

jest.mock('../../lib/confluence/lib/page-manager', () => ({
  setConfig: jest.fn(),
  isPageSafeToUpdate: jest.fn(),
  createPagePayload: jest.fn(),
  addLabelToPage: jest.fn()
}))

jest.mock('../../lib/confluence/lib/content-processor', () => ({
  extractTitle: jest.fn(),
  readFileContent: jest.fn(),
  filterContentForFormat: jest.fn(),
  convertMarkdownToAtlasDoc: jest.fn(),
  addWarningPanelToAtlas: jest.fn()
}))

jest.mock('../../lib/confluence/lib/github', () => ({
  getGitHubSourceUrl: jest.fn()
}))

jest.mock('../../lib/confluence/lib/image-handler', () => ({
  setConfig: jest.fn(),
  findMermaidDiagram: jest.fn(),
  uploadImageAttachment: jest.fn(),
  replaceImagePlaceholdersAtlas: jest.fn()
}))

jest.mock('../../lib/confluence/lib/hierarchy-manager', () => ({
  setConfig: jest.fn(),
  getSpaceForPath: jest.fn(),
  getParentForPath: jest.fn()
}))

const apiClient = require('../../lib/confluence/lib/api-client')
const pageManager = require('../../lib/confluence/lib/page-manager')
const contentProcessor = require('../../lib/confluence/lib/content-processor')
const github = require('../../lib/confluence/lib/github')
const imageHandler = require('../../lib/confluence/lib/image-handler')
const hierarchyManager = require('../../lib/confluence/lib/hierarchy-manager')
const { publish } = require('../../lib/confluence')

describe('publishing a markdown page', () => {
  const configJson = JSON.stringify({
    spaceMapping: { EUDP: 'EUDP' },
    publishPaths: [
      { path: 'systems/EUDP/page.md', type: 'markdown' },
      { path: 'systems/EUDP/other.md', type: 'markdown' }
    ]
  })
  const options = {
    configPath: 'confluence-config.json',
    fileFilter: 'docs/systems/EUDP/page.md',
    auth: { username: 'user', apiToken: 'token' },
    contentRoot: 'docs',
    confluenceUrl: 'https://test.atlassian.net'
  }
  const spies = []

  // Replace the config the publisher reads for one test
  function useConfig (publishPaths) {
    const json = JSON.stringify({ spaceMapping: { EUDP: 'EUDP' }, publishPaths })
    fs.promises.readFile.mockResolvedValue(json)
    fs.readFileSync.mockReturnValue(json)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    spies.push(
      jest.spyOn(fs.promises, 'readFile').mockResolvedValue(configJson),
      jest.spyOn(fs, 'readFileSync').mockReturnValue(configJson),
      jest.spyOn(fs.promises, 'access').mockResolvedValue(),
      jest.spyOn(console, 'error').mockImplementation(() => {})
    )

    hierarchyManager.getSpaceForPath.mockResolvedValue('EUDP')
    hierarchyManager.getParentForPath.mockResolvedValue('1')
    contentProcessor.extractTitle.mockImplementation(async (file) => file.endsWith('other.md') ? 'Other' : 'Page')
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n![d](diagrams/d.svg)\n\nSee [next](other.md#part).')
    contentProcessor.filterContentForFormat.mockImplementation(content => content)
    contentProcessor.convertMarkdownToAtlasDoc.mockResolvedValue({ type: 'doc', content: [] })
    contentProcessor.addWarningPanelToAtlas.mockImplementation(atlas => atlas)
    github.getGitHubSourceUrl.mockReturnValue('https://github.com/org/repo/blob/main/page.md')
    apiClient.findPageByTitle.mockResolvedValue({
      count: 1,
      page: { results: [{ id: '555', version: { number: 3 }, status: 'current' }] }
    })
    apiClient.findCurrentPageId.mockResolvedValue('999')
    apiClient.confluenceRequest.mockResolvedValue({ status: 200, body: {} })
    pageManager.isPageSafeToUpdate.mockResolvedValue(true)
    pageManager.createPagePayload.mockReturnValue({})
    pageManager.addLabelToPage.mockResolvedValue(true)
    imageHandler.replaceImagePlaceholdersAtlas.mockImplementation(async atlas => atlas)
  })

  afterEach(() => {
    while (spies.length) spies.pop().mockRestore()
  })

  it('rewrites a relative .md link to the target Confluence page before conversion', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    await publish(options)

    expect(apiClient.findCurrentPageId).toHaveBeenCalledWith('Other', 'EUDP', options.auth)
    expect(contentProcessor.convertMarkdownToAtlasDoc).toHaveBeenCalledWith(
      expect.stringContaining('See [next](https://test.atlassian.net/wiki/spaces/EUDP/pages/999).')
    )
  })

  it('counts the page as published when every image uploads', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toEqual({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalled()
  })

  it('counts the page as failed when an image upload fails', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue(null)

    const result = await publish(options)

    expect(result).toEqual({ success: 0, failed: 1, skipped: 1 })
    expect(console.error).toHaveBeenCalledWith(
      '  ❌ Failed to publish docs/systems/EUDP/page.md: 1 image upload(s) failed: d.svg'
    )
  })

  it('counts the page as failed when a diagram upload fails, after placing the images that uploaded', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n<MermaidDiagram diagramId="flow" />\n\n![d](diagrams/d.svg)')
    imageHandler.findMermaidDiagram.mockResolvedValue('/repo/build/mmd/flow.svg')
    imageHandler.uploadImageAttachment.mockImplementation(async (pageId, imagePath) =>
      imagePath.endsWith('flow.svg') ? null : { attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toEqual({ success: 0, failed: 1, skipped: 1 })
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalledWith(
      expect.anything(), [expect.objectContaining({ viewId: 'd.svg' })], '555'
    )
    expect(console.error).toHaveBeenCalledWith(
      '  ❌ Failed to publish docs/systems/EUDP/page.md: 1 image upload(s) failed: flow.svg'
    )
  })

  it('resolves links to an entry whose type is not markdown but publishes as markdown', async () => {
    useConfig([{ path: 'systems/EUDP/page.md' }, { path: 'systems/EUDP/other.md', type: 'md' }])
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    await publish(options)

    expect(apiClient.findCurrentPageId).toHaveBeenCalledWith('Other', 'EUDP', options.auth)
  })

  it('looks a link target up in the default space when its path maps to no space', async () => {
    process.env.CONFLUENCE_SPACE = 'DEFAULT'
    hierarchyManager.getSpaceForPath.mockImplementation(async (file) => file.endsWith('other.md') ? null : 'EUDP')
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    try {
      await publish(options)
    } finally {
      delete process.env.CONFLUENCE_SPACE
    }

    expect(apiClient.findCurrentPageId).toHaveBeenCalledWith('Other', 'DEFAULT', options.auth)
  })

  it('reports a missing single-file entry as not found and counts it as failed', async () => {
    useConfig([{ path: 'systems/EUDP/missing.md' }])
    fs.promises.access.mockImplementation(async (file) => {
      if (String(file).endsWith('missing.md')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await publish({ ...options, fileFilter: null })

    expect(result).toEqual({ success: 0, failed: 1, skipped: 0 })
    expect(console.error).toHaveBeenCalledWith('  ⚠️  File not found: docs/systems/EUDP/missing.md')
  })

  it('publishes a diagram entry through the diagram path, not as markdown', async () => {
    useConfig([{ path: 'systems/EUDP/page.md', type: 'diagram' }])

    const result = await publish(options)

    expect(result).toEqual({ success: 1, failed: 0, skipped: 0 })
    expect(contentProcessor.convertMarkdownToAtlasDoc).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('  Publishing diagram: Page')
  })
})
