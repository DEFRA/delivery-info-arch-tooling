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

  it('names the source page in the attachment comment', async () => {
    const sent = mockResponse(200, { results: [{ id: 'att42', extensions: { fileId: 'f' } }] })

    await uploadImageAttachment('123', imagePath, auth, 'docs/systems/A/page.md')

    expect(sent.body).toMatch(/name="comment"\r\n\r\nPublished from docs\/systems\/A\/page\.md\r\n/)
  })

  it('uses a generic attachment comment when no source page is given', async () => {
    const sent = mockResponse(200, { results: [{ id: 'att42', extensions: { fileId: 'f' } }] })

    await uploadImageAttachment('123', imagePath, auth)

    expect(sent.body).toMatch(/name="comment"\r\n\r\nPublished by delivery-info-arch-tooling\r\n/)
  })

  it('logs whether the upload created an attachment or updated one', async () => {
    mockResponse(200, { results: [{ id: 'att1', version: { number: 1 }, extensions: { fileId: 'f1' } }] })
    await uploadImageAttachment('123', imagePath, auth)
    mockResponse(200, { results: [{ id: 'att2', version: { number: 3 }, extensions: { fileId: 'f2' } }] })
    await uploadImageAttachment('123', imagePath, auth)

    expect(consoleErrorSpy).toHaveBeenCalledWith('    ✅ Image uploaded successfully (new attachment)')
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ✅ Image uploaded successfully (updated to version 3)')
  })

  it('returns null and names the HTTP status when the body is empty', async () => {
    mockResponse(400, '', 'Bad Request')

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ❌ Failed to upload image (HTTP 400): Bad Request')
  })

  it('accepts a 201 with the attachment at the top level of the body', async () => {
    mockResponse(201, { id: 'att7', title: 'diagram.svg', extensions: { fileId: 'file-7' } })

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toEqual({ attachmentId: 'att7', fileId: 'file-7', filename: 'diagram.svg' })
  })

  it('looks the attachment up by filename when the response carries no IDs', async () => {
    mockResponse(200, { results: [] })
    confluenceRequest.mockResolvedValueOnce({
      status: 200,
      body: { results: [{ id: 'att9', title: 'Diagram.SVG', extensions: { fileId: 'file-9' } }] }
    })

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(confluenceRequest).toHaveBeenCalledWith('GET', '/content/123/child/attachment', { auth })
    expect(result).toEqual({ attachmentId: 'att9', fileId: 'file-9', filename: 'diagram.svg' })
  })

  it('returns null and names the error when the request fails', async () => {
    https.request.mockImplementation(() => {
      const req = new PassThrough()
      process.nextTick(() => req.emit('error', new Error('read ETIMEDOUT')))
      return req
    })

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ❌ Failed to upload image: read ETIMEDOUT')
  })

  it('does not upload in a dry run', async () => {
    setConfig({ dryRun: true })

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(https.request).not.toHaveBeenCalled()
  })
})
