/**
 * Unit tests for uploadImageAttachment and findUnchangedAttachment in confluence/lib/image-handler.js
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
const { setConfig, uploadImageAttachment, findUnchangedAttachment } = require('../../lib/confluence/lib/image-handler')

const auth = { username: 'user', apiToken: 'token' }
const basicAuth = `Basic ${Buffer.from('user:token').toString('base64')}`
const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>'

/**
 * Make https.request answer each call with the next of the given responses,
 * and record the request options and the multipart body last sent
 */
function mockResponses (responses) {
  const queue = [...responses]
  const sent = { options: null, body: '' }
  https.request.mockImplementation((options, callback) => {
    const { status, body, statusMessage = '' } = queue.shift()
    sent.options = options
    sent.body = ''
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

/**
 * Make https.request answer every call with the given status and body
 */
function mockResponse (status, body, statusMessage = '') {
  return mockResponses([{ status, body, statusMessage }])
}

describe('uploadImageAttachment', () => {
  let tmpDir
  let imagePath
  let consoleErrorSpy

  beforeEach(() => {
    jest.clearAllMocks()
    setConfig({ confluenceUrl: 'https://test.atlassian.net', dryRun: false, uploadRetryDelayMs: 0 })
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
    expect(https.request).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ❌ Failed to upload image (HTTP 400): Bad Request')
  })

  it('retries once after the pause when the upload answers HTTP 500, and takes the second answer', async () => {
    setConfig({ uploadRetryDelayMs: 10 })
    const timeoutSpy = jest.spyOn(global, 'setTimeout')
    mockResponses([
      { status: 500, body: { message: 'Transaction rolled back because it has been marked as rollback-only' } },
      { status: 200, body: { results: [{ id: 'att42', title: 'diagram.svg', version: { number: 14 }, extensions: { fileId: 'file-14' } }] } }
    ])

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10)
    expect(https.request).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ attachmentId: 'att42', fileId: 'file-14', filename: 'diagram.svg' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '    ⚠️  Upload of diagram.svg answered HTTP 500, retrying once after 10 ms: Transaction rolled back because it has been marked as rollback-only'
    )
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('❌'))
    timeoutSpy.mockRestore()
  })

  it('counts the upload as failed after a second HTTP 500', async () => {
    mockResponses([
      { status: 500, body: { message: 'rolled back' } },
      { status: 500, body: { message: 'rolled back again' } }
    ])

    const result = await uploadImageAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(https.request).toHaveBeenCalledTimes(2)
    expect(consoleErrorSpy).toHaveBeenCalledWith('    ❌ Failed to upload image (HTTP 500): rolled back again')
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

describe('findUnchangedAttachment', () => {
  let tmpDir
  let imagePath
  let consoleErrorSpy
  let fetchSpy

  const attachment = {
    id: 'att5',
    title: 'diagram.svg',
    version: { number: 13 },
    extensions: { fileId: 'file-13' },
    _links: { download: '/download/attachments/123/diagram.svg?version=13&api=v2' }
  }
  const listing = (results, links = { base: 'https://other.example/wiki' }) => ({
    status: 200,
    body: { results, ...(links && { _links: links }) }
  })
  const download = (text, ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => Buffer.from(text) })

  beforeEach(() => {
    jest.clearAllMocks()
    setConfig({ confluenceUrl: 'https://test.atlassian.net', dryRun: false })
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-compare-'))
    imagePath = path.join(tmpDir, 'diagram.svg')
    fs.writeFileSync(imagePath, svg)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(download(svg))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    consoleErrorSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('returns the current attachment when its bytes equal the image file, without uploading', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([attachment]))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(confluenceRequest).toHaveBeenCalledWith(
      'GET', '/content/123/child/attachment?filename=diagram.svg&expand=version', { auth }
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://other.example/wiki/download/attachments/123/diagram.svg?version=13&api=v2',
      { headers: { Authorization: basicAuth } }
    )
    expect(result).toEqual({ attachmentId: 'att5', fileId: 'file-13', filename: 'diagram.svg', version: 13 })
    expect(https.request).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledWith('    → Image unchanged, reusing attachment version 13: diagram.svg')
  })

  it('downloads from the configured site when the listing names no base', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([attachment], null))

    await findUnchangedAttachment('123', imagePath, auth)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.atlassian.net/wiki/download/attachments/123/diagram.svg?version=13&api=v2',
      expect.anything()
    )
  })

  it('matches the attachment by file name regardless of case', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([{ ...attachment, title: 'Diagram.SVG' }]))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toMatchObject({ attachmentId: 'att5', filename: 'Diagram.SVG' })
  })

  it('returns null when the attachment bytes differ from the image file', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([attachment]))
    fetchSpy.mockResolvedValue(download('<svg/>'))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toBeNull()
  })

  it('returns null without downloading when the listing reports a different size', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([{ ...attachment, extensions: { fileId: 'file-13', fileSize: 999 } }]))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('downloads and compares when the listing reports the same size', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([{ ...attachment, extensions: { fileId: 'file-13', fileSize: Buffer.byteLength(svg) } }]))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ attachmentId: 'att5', fileId: 'file-13' })
  })

  it('returns null without downloading when the page has no attachment with that file name', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([]))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null when the download is refused', async () => {
    confluenceRequest.mockResolvedValueOnce(listing([attachment]))
    fetchSpy.mockResolvedValue(download('', false))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toBeNull()
  })

  it('returns null and says so when the listing fails', async () => {
    confluenceRequest.mockRejectedValueOnce(new Error('HTTP request failed: read ECONNRESET'))

    const result = await findUnchangedAttachment('123', imagePath, auth)

    expect(result).toBeNull()
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "    🔍 Could not compare 'diagram.svg' with its attachment, uploading it: HTTP request failed: read ECONNRESET"
    )
  })

  it('returns null without a request when the image file does not exist', async () => {
    const result = await findUnchangedAttachment('123', path.join(tmpDir, 'missing.svg'), auth)

    expect(result).toBeNull()
    expect(confluenceRequest).not.toHaveBeenCalled()
  })
})
