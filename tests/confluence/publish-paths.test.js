/**
 * Unit tests for expandPublishPaths in confluence/index.js, against real files
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { expandPublishPaths } = require('../../lib/confluence')

describe('expandPublishPaths', () => {
  let root

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-paths-'))
    fs.mkdirSync(path.join(root, 'systems', 'A', 'folder.md'), { recursive: true })
    for (const file of ['systems/A/one.md', 'systems/A/two.md', 'systems/A/README.md', 'systems/A/diagram.md']) {
      fs.writeFileSync(path.join(root, file), '# Page\n')
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const names = entry => entry.files.map(({ file, excluded }) => `${path.basename(file)}${excluded ? ' (excluded)' : ''}`).sort()

  it('lists the regular files a glob matches and marks the excluded ones', async () => {
    const [entry] = await expandPublishPaths({
      publishPaths: [{ path: 'systems/A/*.md', exclude: ['README.md'] }]
    }, root)

    expect(entry.isGlob).toBe(true)
    expect(entry.pathType).toBe('markdown')
    expect(names(entry)).toEqual(['README.md (excluded)', 'diagram.md', 'one.md', 'two.md'])
    expect(entry.matched).toBe(5) // includes the folder named folder.md, which is not listed
  })

  it('lists a single-file entry as written, without checking it exists or applying exclude', async () => {
    const [entry] = await expandPublishPaths({
      publishPaths: [{ path: 'systems/A/missing.md', exclude: ['missing.md'] }]
    }, root)

    expect(entry).toEqual({
      pathType: 'markdown',
      isGlob: false,
      pattern: path.join(root, 'systems/A/missing.md'),
      matched: 1,
      files: [{ file: path.join(root, 'systems/A/missing.md'), excluded: false }]
    })
  })

  it('keeps the entry type, so any type other than diagram publishes as markdown', async () => {
    const entries = await expandPublishPaths({
      publishPaths: [
        { path: 'systems/A/one.md', type: 'md' },
        { path: 'systems/A/diagram.md', type: 'diagram' }
      ]
    }, root)

    expect(entries.map(e => e.pathType)).toEqual(['md', 'diagram'])
  })

  it('reports a glob with no matches and skips entries with no path', async () => {
    const entries = await expandPublishPaths({
      publishPaths: [{ path: 'systems/B/*.md' }, { description: 'no path' }]
    }, root)

    expect(entries).toHaveLength(1)
    expect(entries[0].matched).toBe(0)
    expect(entries[0].files).toEqual([])
  })

  it('returns nothing when publishPaths is missing', async () => {
    expect(await expandPublishPaths({}, root)).toEqual([])
  })
})
