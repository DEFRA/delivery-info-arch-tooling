/**
 * Unit tests for confluence/index.js
 */

const fs = require('fs')
const { glob } = require('glob')

jest.mock('glob', () => ({
  glob: jest.fn()
}))

jest.mock('../../lib/confluence/lib/api-client', () => ({
  setConfig: jest.fn()
}))

jest.mock('../../lib/confluence/lib/page-manager', () => ({
  setConfig: jest.fn()
}))

jest.mock('../../lib/confluence/lib/content-processor', () => ({}))

jest.mock('../../lib/confluence/lib/github', () => ({}))

jest.mock('../../lib/confluence/lib/image-handler', () => ({
  setConfig: jest.fn()
}))

jest.mock('../../lib/confluence/lib/hierarchy-manager', () => ({
  setConfig: jest.fn()
}))

const { publish } = require('../../lib/confluence')

describe('confluence index', () => {
  let readFileSpy
  let readFileSyncSpy
  let consoleErrorSpy
  const configJson = JSON.stringify({
    spaceMapping: {
      EUDP: 'EUDP'
    },
    publishPaths: [
      {
        path: 'systems/EUDP/TRACES Integration Gateway/TIG - Technology/TIG - Analysis/API Calls/**/*.md',
        type: 'markdown'
      }
    ]
  })

  beforeEach(() => {
    jest.clearAllMocks()
    readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(configJson)
    readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(configJson)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    readFileSpy.mockRestore()
    readFileSyncSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('should normalize glob publish paths for cross-platform matching', async () => {
    glob.mockResolvedValueOnce([])

    const result = await publish({
      configPath: 'C:/temp/confluence-config.json',
      auth: {
        username: 'user',
        apiToken: 'token'
      },
      contentRoot: 'docs'
    })

    expect(glob).toHaveBeenCalledWith('docs/systems/EUDP/TRACES Integration Gateway/TIG - Technology/TIG - Analysis/API Calls/**/*.md')
    expect(result).toEqual({
      success: 0,
      failed: 0,
      skipped: 1
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "  ⚠️  No files matched: docs/systems/EUDP/TRACES Integration Gateway/TIG - Technology/TIG - Analysis/API Calls/**/*.md"
    )
  })
})
