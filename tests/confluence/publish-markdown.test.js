/**
 * Unit tests for publishing one markdown page through confluence/index.js
 */

const fs = require('fs')
const path = require('path')

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
  addLabelToPage: jest.fn(),
  handle403Error: jest.fn()
}))

jest.mock('../../lib/confluence/lib/content-processor', () => ({
  extractTitle: jest.fn(),
  extractConfluenceParent: jest.fn(),
  readFileContent: jest.fn(),
  filterContentForFormat: jest.fn(),
  convertMarkdownToAtlasDoc: jest.fn(),
  addWarningPanelToAtlas: jest.fn(),
  convertMarkdownToStorage: jest.fn(),
  addWarningPanelToContent: jest.fn()
}))

jest.mock('../../lib/confluence/lib/github', () => ({
  getGitHubSourceUrl: jest.fn(),
  getDiagramSourceCaption: jest.fn()
}))

jest.mock('../../lib/confluence/lib/image-handler', () => ({
  setConfig: jest.fn(),
  findMermaidDiagram: jest.fn(),
  findMermaidSource: jest.fn(),
  findUnchangedAttachment: jest.fn(),
  uploadImageAttachment: jest.fn(),
  replaceImagePlaceholdersAtlas: jest.fn(),
  replaceImagePlaceholders: jest.fn()
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
    contentProcessor.extractConfluenceParent.mockResolvedValue(null)
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
    imageHandler.findUnchangedAttachment.mockResolvedValue(null)
    imageHandler.replaceImagePlaceholdersAtlas.mockImplementation(async atlas => atlas)
  })

  // Record the page writes, uploads and label adds in the order they happen,
  // with the version each write carries
  function recordCalls () {
    const calls = []
    pageManager.createPagePayload.mockImplementation((title, body, parent, version) =>
      version ? { version: { number: version } } : {})
    pageManager.addLabelToPage.mockImplementation(async () => { calls.push('label') })
    imageHandler.uploadImageAttachment.mockImplementation(async (pageId, imagePath) => {
      const name = path.basename(imagePath)
      calls.push(`upload ${name} to ${pageId}`)
      return { attachmentId: `att-${path.basename(name, '.svg')}`, fileId: 'f', filename: name }
    })
    apiClient.confluenceRequest.mockImplementation(async (method, endpoint, { body } = {}) => {
      if (method === 'POST') {
        calls.push('POST /content')
        return { status: 201, body: { id: '600' } }
      }
      if (method === 'PUT') {
        calls.push(`PUT ${endpoint} v${body.version.number}`)
      }
      return { status: 200, body: {} }
    })
    return calls
  }

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

  it('keeps the folder parent and does not reparent when the frontmatter names no parent', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    await publish(options)

    expect(pageManager.createPagePayload).toHaveBeenCalledWith('Page', expect.anything(), '1', 4, 'EUDP', true, false)
  })

  it('moves the page under the parent its frontmatter names, found by title', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })
    contentProcessor.extractConfluenceParent.mockResolvedValue('Parent Page')
    apiClient.findPageByTitle.mockImplementation(async (title) => title === 'Parent Page'
      ? { count: 1, page: { results: [{ id: '777', version: { number: 1 }, status: 'current' }] } }
      : { count: 1, page: { results: [{ id: '555', version: { number: 3 }, status: 'current' }] } })

    await publish(options)

    expect(apiClient.findPageByTitle).toHaveBeenCalledWith('Parent Page', 'EUDP', options.auth)
    expect(pageManager.createPagePayload).toHaveBeenCalledWith('Page', expect.anything(), '777', 4, 'EUDP', true, true)
  })

  it('fails the page rather than publish it in the wrong place when the named parent does not exist', async () => {
    contentProcessor.extractConfluenceParent.mockResolvedValue('Missing Parent')
    apiClient.findPageByTitle.mockImplementation(async (title) => title === 'Missing Parent'
      ? { count: 0, page: { results: [] } }
      : { count: 1, page: { results: [{ id: '555', version: { number: 3 }, status: 'current' }] } })

    const result = await publish(options)

    expect(result.failed).toBe(1)
    expect(apiClient.confluenceRequest).not.toHaveBeenCalledWith('PUT', expect.anything(), expect.anything())
  })

  it('checks the links on the published page and counts a broken one', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })
    const stored = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '#nowhere' } }] }] }] }
    apiClient.confluenceRequest.mockImplementation(async (method, endpoint) =>
      method === 'GET' && endpoint === '/content/555?expand=body.atlas_doc_format'
        ? { status: 200, body: { title: 'Page', body: { atlas_doc_format: { value: JSON.stringify(stored) } } } }
        : { status: 200, body: {} })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, brokenLinks: 1, unreachableLinks: 0 })
    expect(console.error).toHaveBeenCalledWith("  ❌ Broken link on 'Page': #nowhere (no heading on this page has that anchor)")
  })

  it('counts the page as published when every image uploads', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalled()
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledWith(
      '555', expect.stringMatching(/diagrams[\\/]d\.svg$/), options.auth, 'docs/systems/EUDP/page.md'
    )
  })

  it('uploads every image before the one page write, at the looked-up version plus one', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n![a](diagrams/a.svg)\n\n![b](diagrams/b.svg)')
    const calls = recordCalls()

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(calls).toEqual(['upload a.svg to 555', 'upload b.svg to 555', 'PUT /content/555 v4', 'label'])
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ viewId: 'a.svg', originalPath: 'diagrams/a.svg', attachmentInfo: 'att-a|f|a.svg' }),
      expect.objectContaining({ viewId: 'b.svg', originalPath: 'diagrams/b.svg', attachmentInfo: 'att-b|f|b.svg' })
    ], '555')
    expect(console.error).toHaveBeenCalledWith('  ✅ Updated successfully (ID: 555)')
  })

  it('counts the page as failed and writes nothing to it when an image upload fails', async () => {
    imageHandler.uploadImageAttachment.mockResolvedValue(null)

    const result = await publish(options)

    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 1 })
    expect(apiClient.confluenceRequest).not.toHaveBeenCalledWith('PUT', expect.anything(), expect.anything())
    expect(apiClient.confluenceRequest).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything())
    expect(imageHandler.replaceImagePlaceholdersAtlas).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Updated successfully'))
    expect(console.error).toHaveBeenCalledWith(
      '  ❌ Failed to publish docs/systems/EUDP/page.md: 1 image upload(s) failed: d.svg'
    )
  })

  it('reuses the current attachment when the image bytes are unchanged, without uploading', async () => {
    imageHandler.findUnchangedAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f13', filename: 'd.svg', version: 13 })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.findUnchangedAttachment).toHaveBeenCalledWith(
      '555', expect.stringMatching(/diagrams[\\/]d\.svg$/), options.auth
    )
    expect(imageHandler.uploadImageAttachment).not.toHaveBeenCalled()
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalledWith(
      expect.anything(), [expect.objectContaining({ viewId: 'd.svg', attachmentInfo: 'att1|f13|d.svg' })], '555'
    )
    expect(apiClient.confluenceRequest).toHaveBeenCalledWith('PUT', '/content/555', expect.anything())
    expect(console.error).not.toHaveBeenCalledWith('    → Uploaded manual diagram: d.svg')
  })

  it('creates a new page, attaches its images, then writes it once more at version 2', async () => {
    apiClient.findPageByTitle.mockResolvedValue({ count: 0, page: { results: [] } })
    const calls = recordCalls()

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(calls).toEqual(['POST /content', 'label', 'upload d.svg to 600', 'PUT /content/600 v2'])
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalledWith(expect.anything(), expect.anything(), '600')
    expect(console.error).toHaveBeenCalledWith('  ✅ Created successfully (ID: 600)')
  })

  it('leaves a new page at its first version when an image upload fails', async () => {
    apiClient.findPageByTitle.mockResolvedValue({ count: 0, page: { results: [] } })
    const calls = recordCalls()
    imageHandler.uploadImageAttachment.mockResolvedValue(null)

    const result = await publish(options)

    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 1 })
    expect(calls).toEqual(['POST /content', 'label'])
    expect(console.error).toHaveBeenCalledWith('  ✅ Created successfully (ID: 600)')
    expect(console.error).toHaveBeenCalledWith(
      '  ❌ Failed to publish docs/systems/EUDP/page.md: 1 image upload(s) failed: d.svg'
    )
  })

  it('creates the page afresh, with its images attached again, when the update is refused', async () => {
    const calls = recordCalls()
    pageManager.handle403Error.mockResolvedValue({ canContinue: true })
    apiClient.confluenceRequest.mockImplementation(async (method, endpoint, { body } = {}) => {
      if (method === 'POST') {
        calls.push('POST /content')
        return { status: 201, body: { id: '600' } }
      }
      if (method === 'PUT') {
        calls.push(`PUT ${endpoint} v${body.version.number}`)
        return { status: endpoint === '/content/555' ? 403 : 200, body: {} }
      }
      return { status: 200, body: {} }
    })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(calls).toEqual([
      'upload d.svg to 555', 'PUT /content/555 v4', 'POST /content', 'label', 'upload d.svg to 600', 'PUT /content/600 v2'
    ])
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), '600')
  })

  it('uploads an image used twice on a page once', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n![d](diagrams/d.svg)\n\nText.\n\n![d again](diagrams/d.svg)')
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledTimes(1)
    expect(imageHandler.replaceImagePlaceholdersAtlas).toHaveBeenCalledWith(
      expect.anything(), [expect.objectContaining({ viewId: 'd.svg', originalPath: 'diagrams/d.svg' })], '555'
    )
  })

  it('reports a failed upload of an image used twice once', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n![d](diagrams/d.svg)\n\n![d again](diagrams/d.svg)')
    imageHandler.uploadImageAttachment.mockResolvedValue(null)

    const result = await publish(options)

    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 1 })
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith(
      '  ❌ Failed to publish docs/systems/EUDP/page.md: 1 image upload(s) failed: d.svg'
    )
  })

  it('uploads a Mermaid diagram used twice on a page once', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n<MermaidDiagram diagramId="flow" />\n\nText.\n\n<MermaidDiagram diagramId="flow" />')
    imageHandler.findMermaidDiagram.mockResolvedValue('build/mmd/flow.svg')
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att2', fileId: 'f2', filename: 'flow.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledTimes(1)
  })

  it('uploads a file used both as a Mermaid diagram and as a markdown image once', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n<MermaidDiagram diagramId="flow" />\n\n![flow](../../../build/mmd/flow.svg)')
    imageHandler.findMermaidDiagram.mockResolvedValue('build/mmd/flow.svg')
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att2', fileId: 'f2', filename: 'flow.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledTimes(1)
  })

  it('places the images in the storage-format body when the ADF conversion fails', async () => {
    contentProcessor.convertMarkdownToAtlasDoc.mockRejectedValue(new Error('converter missing'))
    contentProcessor.addWarningPanelToContent.mockImplementation(content => content)
    contentProcessor.convertMarkdownToStorage.mockReturnValue('<p>storage body</p>')
    imageHandler.replaceImagePlaceholders.mockReturnValue('<p>storage body with image</p>')
    imageHandler.uploadImageAttachment.mockResolvedValue({ attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 1 })
    expect(imageHandler.replaceImagePlaceholders).toHaveBeenCalledWith(
      '<p>storage body</p>', [expect.objectContaining({ viewId: 'd.svg' })], 'storage'
    )
    expect(imageHandler.replaceImagePlaceholdersAtlas).not.toHaveBeenCalled()
    expect(pageManager.createPagePayload).toHaveBeenCalledWith('Page', '<p>storage body with image</p>', '1', 4, 'EUDP', false, false)
  })

  it('counts the page as failed and writes nothing when one of two uploads fails', async () => {
    contentProcessor.readFileContent.mockResolvedValue('# Page\n\n<MermaidDiagram diagramId="flow" />\n\n![d](diagrams/d.svg)')
    imageHandler.findMermaidDiagram.mockResolvedValue('/repo/build/mmd/flow.svg')
    imageHandler.uploadImageAttachment.mockImplementation(async (pageId, imagePath) =>
      imagePath.endsWith('flow.svg') ? null : { attachmentId: 'att1', fileId: 'f1', filename: 'd.svg' })

    const result = await publish(options)

    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 1 })
    expect(imageHandler.uploadImageAttachment).toHaveBeenCalledTimes(2)
    expect(apiClient.confluenceRequest).not.toHaveBeenCalledWith('PUT', expect.anything(), expect.anything())
    expect(imageHandler.replaceImagePlaceholdersAtlas).not.toHaveBeenCalled()
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

    expect(result).toMatchObject({ success: 0, failed: 1, skipped: 0 })
    expect(console.error).toHaveBeenCalledWith('  ⚠️  File not found: docs/systems/EUDP/missing.md')
  })

  it('publishes a diagram entry through the diagram path, not as markdown', async () => {
    useConfig([{ path: 'systems/EUDP/page.md', type: 'diagram' }])

    const result = await publish(options)

    expect(result).toMatchObject({ success: 1, failed: 0, skipped: 0 })
    expect(contentProcessor.convertMarkdownToAtlasDoc).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('  Publishing diagram: Page')
  })
})
