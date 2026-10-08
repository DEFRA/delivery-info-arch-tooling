/**
 * Unit tests for confluence/lib/image-handler.js (Mermaid source resolution)
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('../../lib/confluence/lib/api-client', () => ({
  confluenceRequest: jest.fn()
}))

const { findMermaidSource } = require('../../lib/confluence/lib/image-handler')

describe('image-handler findMermaidSource', () => {
  let tmpDir
  const originalCwd = process.cwd()

  const write = (relPath) => {
    const abs = path.join(tmpDir, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, 'flowchart LR\n  a --> b\n')
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-handler-'))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds a source anywhere in the repo without a configured mmdDir', async () => {
    write('architecture/dr/DR-004-journey-domain-topology/dr-eudp-004.mmd')

    const result = await findMermaidSource('dr-eudp-004')

    expect(result).toBe(path.join('architecture', 'dr', 'DR-004-journey-domain-topology', 'dr-eudp-004.mmd'))
  })

  it('finds a source in a legacy mmd folder without a configured mmdDir', async () => {
    write('architecture/current/btms/mmd/btms-flow.mmd')

    const result = await findMermaidSource('btms-flow')

    expect(result).toBe(path.join('architecture', 'current', 'btms', 'mmd', 'btms-flow.mmd'))
  })

  it('prefers the configured mmdDir when the file exists there', async () => {
    write('architecture/adr/ADR-001/shared.mmd')
    write('custom/mmd/shared.mmd')

    const result = await findMermaidSource('shared', 'custom/mmd')

    expect(result).toBe(path.join('custom', 'mmd', 'shared.mmd'))
  })

  it('falls back to a repo search when the file is not in the configured mmdDir', async () => {
    write('architecture/adr/ADR-001/elsewhere.mmd')

    const result = await findMermaidSource('elsewhere', 'custom/mmd')

    expect(result).toBe(path.join('architecture', 'adr', 'ADR-001', 'elsewhere.mmd'))
  })

  it('ignores node_modules, build and generated directories', async () => {
    write('node_modules/some-pkg/diagram.mmd')
    write('build/mmd/diagram.mmd')
    write('generated/diagram.mmd')

    const result = await findMermaidSource('diagram')

    expect(result).toBeNull()
  })

  it('chooses deterministically when several files share a basename', async () => {
    write('zeta/dup.mmd')
    write('alpha/dup.mmd')

    const result = await findMermaidSource('dup')

    expect(result).toBe(path.join('alpha', 'dup.mmd'))
  })

  it('returns null when no source exists', async () => {
    const result = await findMermaidSource('missing')

    expect(result).toBeNull()
  })
})
