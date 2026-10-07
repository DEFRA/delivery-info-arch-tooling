/**
 * Unit tests for uploadImageAttachment in confluence/lib/image-handler.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PassThrough } = require('stream')
const { EventEmitter } = require('events')

jest.mock('https', () => ({ request: jest.fn() }))
jest.mock('../../lib/confluence/lib/api-client', () => ({ confluenceRequest: jest.fn() }))

const https = require('https')
const { confluenceRequest } = require('../../lib/confluence/lib/api-client')
const { setConfig, uploadImageAttachment } = require('../../lib/confluence/lib/image-handler')

const auth = { username: 'user', apiToken: 'token' }

/**
 * Make https.request answer with the given status and body, and record
 * the request options and the multipart body sent
 */
function mockResponse (status, body, statusMessage = '') {
  const sent = { options: null, body: '' }
  https.request.mockImplementation((options, callback) => {
    sent.options = options
    const req = new PassThrough()
    req.on('data', chunk => { sent.body += chunk.toString() })
    req.on('end', () => {
      const res = new EventEmitter()
      res.statusCode = status
      res.statusMessage = statusMessage
      res.headers = {}
      callback(res)
      res.emit('data', typeof body === 'string' ? body : JSON.stringify(body))
      res.emit('end')
    })
    return req
  })
  return sent
}

describe('uploadImageAttachment', () => {
  let tmpDir
  let imagePath
  let consoleErrorSpy

  beforeEach(() => {
    jest.clearAllMocks()
    setConfig({ confluenceUrl: 'https://test.atlassian.net', dryRun: false })
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-upload-'))
    imagePath = path.join(tmpDir, 'diagram.svg')
    fs.writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg"/>')
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    consoleErrorSpy.mockRestore()
  })

  it('creates or updates with one PUT to the attachment collection, as a minor edit', async () => {
    const sent = mockResponse(200, {
      results: [{ id: 'att42', title: 'diagram.svg', extensions: { fileId: 'file-new' } }]
    })

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(sent.options.method).toBe('PUT')
    expect(sent.options.path).toBe('/wiki/rest/api/content/123/child/attachment')
    expect(sent.body).toMatch(/name="minorEdit"\r\n\r\ntrue/)
    expect(sent.body).toMatch(/filename="diagram.svg"/)
    expect(confluenceRequest).not.toHaveBeenCalled()
    expect(result).toEqual({ attachmentId: 'att42', fileId: 'file-new', filename: 'diagram.svg' })
  })

  it('returns null and names the HTTP status when the body is empty', async () => {
    mockResponse(400, '', 'Bad Request')

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ❌ Failed to upload image (HTTP 400): Bad Request')
  })
})
