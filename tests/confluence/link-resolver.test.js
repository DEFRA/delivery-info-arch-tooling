/**
 * Unit tests for confluence/lib/link-resolver.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  createLinkResolver,
  isRelativeMarkdownLink,
  resolveTargetPath
} = require('../../lib/confluence/lib/link-resolver')

describe('link-resolver', () => {
  let tmpDir
  let source
  let published
  let unpublished
  let notInConfig
  let consoleErrorSpy

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-resolver-'))
    fs.mkdirSync(path.join(tmpDir, 'sub dir'))
    source = path.join(tmpDir, 'source.md')
    published = path.join(tmpDir, 'sub dir', 'published page.md')
    unpublished = path.join(tmpDir, 'unpublished.md')
    notInConfig = path.join(tmpDir, 'not-in-config.md')
    for (const file of [source, published, unpublished, notInConfig]) {
      fs.writeFileSync(file, '# Title\n')
    }
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    consoleErrorSpy.mockRestore()
  })

  function makeResolver (overrides = {}) {
    const options = {
      getPublishableFiles: jest.fn().mockResolvedValue(new Set([source, published, unpublished])),
      extractTitle: jest.fn(async (file) => path.basename(file, '.md')),
      getSpaceForPath: jest.fn().mockResolvedValue('EUDP'),
      findPageId: jest.fn(async (title) => (title === 'published page' ? '123' : null)),
      getGitHubSourceUrl: jest.fn((file) => `https://github.com/org/repo/blob/main/${file}`),
      confluenceUrl: 'https://test.atlassian.net',
      ...overrides
    }
    return { resolver: createLinkResolver(options), options }
  }

  describe('isRelativeMarkdownLink', () => {
    it('accepts relative .md paths, with or without an anchor', () => {
      expect(isRelativeMarkdownLink('other.md')).toBe(true)
      expect(isRelativeMarkdownLink('../dir/Other%20Page.md#section')).toBe(true)
    })

    it('rejects URLs, absolute paths, bare anchors and non-markdown files', () => {
      expect(isRelativeMarkdownLink('https://example.com/page.md')).toBe(false)
      expect(isRelativeMarkdownLink('mailto:someone@example.com')).toBe(false)
      expect(isRelativeMarkdownLink('/docs/page.md')).toBe(false)
      expect(isRelativeMarkdownLink('#section')).toBe(false)
      expect(isRelativeMarkdownLink('diagrams/image.svg')).toBe(false)
    })
  })

  describe('resolveTargetPath', () => {
    it('decodes escapes and drops the anchor', () => {
      expect(resolveTargetPath('sub%20dir/published%20page.md#x', source)).toBe(published)
    })
  })

  describe('rewriteLinks', () => {
    it('links a published target to its Confluence page and drops the anchor', async () => {
      const { resolver } = makeResolver()
      const result = await resolver.rewriteLinks('See [the page](sub%20dir/published%20page.md#part-two).', source)
      expect(result).toBe('See [the page](https://test.atlassian.net/wiki/spaces/EUDP/pages/123).')
    })

    it('falls back to GitHub with a warning when the target has no page yet', async () => {
      const { resolver } = makeResolver()
      const result = await resolver.rewriteLinks('[next](unpublished.md)', source)
      expect(result).toBe(`[next](https://github.com/org/repo/blob/main/${path.relative(process.cwd(), unpublished)})`)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "    ⚠️  Link not resolved to a Confluence page: unpublished.md (no page titled 'unpublished' in space EUDP); linking to GitHub"
      )
    })

    it('falls back to GitHub without a lookup when the target is not in publishPaths', async () => {
      const { resolver, options } = makeResolver()
      await resolver.rewriteLinks('[other](not-in-config.md)', source)
      expect(options.findPageId).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '    ⚠️  Link not resolved to a Confluence page: not-in-config.md (not in publishPaths); linking to GitHub'
      )
    })

    it('leaves the link unchanged when the target file does not exist and GitHub is unknown', async () => {
      const { resolver } = makeResolver({ getGitHubSourceUrl: jest.fn().mockReturnValue(null) })
      const result = await resolver.rewriteLinks('[gone](missing.md)', source)
      expect(result).toBe('[gone](missing.md)')
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '    ⚠️  Link not resolved to a Confluence page: missing.md (target file not found); left unchanged'
      )
    })

    it('leaves images, code spans and fenced code alone', async () => {
      const { resolver } = makeResolver()
      const content = [
        '![diagram](sub%20dir/published%20page.md)',
        '`[code](sub%20dir/published%20page.md)`',
        '```',
        '[fenced](sub%20dir/published%20page.md)',
        '```'
      ].join('\n')
      expect(await resolver.rewriteLinks(content, source)).toBe(content)
    })

    it('looks each target up once per run', async () => {
      const { resolver, options } = makeResolver()
      await resolver.rewriteLinks('[a](sub%20dir/published%20page.md) [b](sub%20dir/published%20page.md#x)', source)
      await resolver.rewriteLinks('[c](sub%20dir/published%20page.md)', source)
      expect(options.findPageId).toHaveBeenCalledTimes(1)
    })
  })
})
