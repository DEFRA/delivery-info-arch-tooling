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
  let outsideDir
  let source
  let published
  let unpublished
  let notInConfig
  let outside
  let consoleErrorSpy
  let cwdSpy

  beforeEach(() => {
    // The temp dir stands in for the repo root, so GitHub fallbacks resolve inside it
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-resolver-'))
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-resolver-outside-'))
    fs.mkdirSync(path.join(tmpDir, 'sub dir'))
    source = path.join(tmpDir, 'source.md')
    published = path.join(tmpDir, 'sub dir', 'published page.md')
    unpublished = path.join(tmpDir, 'unpublished.md')
    notInConfig = path.join(tmpDir, 'not-in-config.md')
    outside = path.join(outsideDir, 'outside.md')
    for (const file of [source, published, unpublished, notInConfig, outside]) {
      fs.writeFileSync(file, '# Title\n')
    }
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(outsideDir, { recursive: true, force: true })
  })

  function makeResolver (overrides = {}) {
    const options = {
      publishableFiles: new Set([source, published, unpublished, outside]),
      extractTitle: jest.fn(async (file) => path.basename(file, '.md')),
      getSpaceForPath: jest.fn().mockResolvedValue('EUDP'),
      findPageId: jest.fn(async (title) => (title === 'published page' ? '123' : null)),
      getGitHubSourceUrl: jest.fn((file) => `https://github.com/org/repo/blob/main/${file}`),
      confluenceUrl: 'https://test.atlassian.net',
      ...overrides
    }
    return { resolver: createLinkResolver(options), options }
  }

  const confluenceLink = 'https://test.atlassian.net/wiki/spaces/EUDP/pages/123'

  describe('isRelativeMarkdownLink', () => {
    it('accepts relative .md paths, with or without an anchor or query', () => {
      expect(isRelativeMarkdownLink('other.md')).toBe(true)
      expect(isRelativeMarkdownLink('./other.MD?x=1')).toBe(true)
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

    it('uses the path as written when an escape is malformed', () => {
      expect(resolveTargetPath('bad%zz.md', source)).toBe(path.join(tmpDir, 'bad%zz.md'))
    })
  })

  describe('rewriteLinks', () => {
    it('links a published target to its Confluence page and drops the anchor', async () => {
      const { resolver } = makeResolver()
      const result = await resolver.rewriteLinks('See [the page](sub%20dir/published%20page.md#part-two).', source)
      expect(result).toBe(`See [the page](${confluenceLink}).`)
    })

    it('rewrites links with a title or an angle-bracketed URL, dropping the title', async () => {
      const { resolver } = makeResolver()
      const content = '[a](sub%20dir/published%20page.md "Title") [b](<sub dir/published page.md>)'
      expect(await resolver.rewriteLinks(content, source)).toBe(`[a](${confluenceLink}) [b](${confluenceLink})`)
    })

    it('falls back to GitHub with a warning when the target has no page yet', async () => {
      const { resolver } = makeResolver()
      const result = await resolver.rewriteLinks('[next](unpublished.md)', source)
      expect(result).toBe('[next](https://github.com/org/repo/blob/main/unpublished.md)')
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

    it('reports a path with no Confluence space without looking it up', async () => {
      const { resolver, options } = makeResolver({ getSpaceForPath: jest.fn().mockResolvedValue(null) })
      await resolver.rewriteLinks('[p](sub%20dir/published%20page.md)', source)
      expect(options.findPageId).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '    ⚠️  Link not resolved to a Confluence page: sub%20dir/published%20page.md (no Confluence space for this path); linking to GitHub'
      )
    })

    it('reports a failed lookup as a failure, not as a missing page', async () => {
      const { resolver } = makeResolver({ findPageId: jest.fn().mockRejectedValue(new Error('page lookup failed (HTTP 429)')) })
      await resolver.rewriteLinks('[p](sub%20dir/published%20page.md)', source)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '    ⚠️  Link not resolved to a Confluence page: sub%20dir/published%20page.md (page lookup failed (HTTP 429)); linking to GitHub'
      )
    })

    it('leaves the link unchanged when the target file does not exist and GitHub is unknown', async () => {
      const { resolver } = makeResolver({ getGitHubSourceUrl: jest.fn().mockReturnValue(null) })
      const result = await resolver.rewriteLinks('[gone](missing.md)', source)
      expect(result).toBe('[gone](missing.md)')
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '    ⚠️  Link not resolved to a Confluence page: missing.md (target file not found); left unchanged'
      )
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    })

    it('does not link to GitHub for a target outside the repo', async () => {
      const { resolver, options } = makeResolver({ findPageId: jest.fn().mockResolvedValue(null) })
      const url = path.relative(tmpDir, outside)
      const result = await resolver.rewriteLinks(`[o](${url})`, source)
      expect(result).toBe(`[o](${url})`)
      expect(options.getGitHubSourceUrl).not.toHaveBeenCalled()
    })

    it('leaves images, code spans, escaped brackets and fenced code alone', async () => {
      const { resolver } = makeResolver()
      const content = [
        '![diagram](sub%20dir/published%20page.md)',
        '`[code](sub%20dir/published%20page.md)`',
        '\\[escaped](sub%20dir/published%20page.md)',
        '```js',
        '[fenced](sub%20dir/published%20page.md)',
        '```',
        '~~~',
        '[tilde](sub%20dir/published%20page.md)',
        '~~~'
      ].join('\n')
      expect(await resolver.rewriteLinks(content, source)).toBe(content)
    })

    it('keeps a longer fence open across a shorter fence inside it', async () => {
      const { resolver } = makeResolver()
      const content = [
        '````markdown',
        '```',
        '[example](sub%20dir/published%20page.md)',
        '```',
        '````',
        '[after](sub%20dir/published%20page.md)'
      ].join('\n')
      const result = await resolver.rewriteLinks(content, source)
      expect(result.split('\n').slice(0, 5).join('\n')).toBe(content.split('\n').slice(0, 5).join('\n'))
      expect(result.split('\n')[5]).toBe(`[after](${confluenceLink})`)
    })

    it('warns about relative .md links in forms it cannot rewrite', async () => {
      const { resolver } = makeResolver()
      const content = '[ref][r]\n\n[r]: unpublished.md\n\n[nested [x] text](not-in-config.md)'
      expect(await resolver.rewriteLinks(content, source)).toBe(content)
      expect(consoleErrorSpy).toHaveBeenCalledWith('    ⚠️  Link not rewritten (unsupported markdown link form): unpublished.md')
      expect(consoleErrorSpy).toHaveBeenCalledWith('    ⚠️  Link not rewritten (unsupported markdown link form): not-in-config.md')
    })

    it('caches a found page for the run', async () => {
      const { resolver, options } = makeResolver()
      await resolver.rewriteLinks('[a](sub%20dir/published%20page.md) [b](sub%20dir/published%20page.md#x)', source)
      await resolver.rewriteLinks('[c](sub%20dir/published%20page.md)', source)
      expect(options.findPageId).toHaveBeenCalledTimes(1)
    })

    it('looks a missing page up again, so a page created later in the run is linked', async () => {
      const findPageId = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('456')
      const { resolver } = makeResolver({ findPageId })
      expect(await resolver.rewriteLinks('[n](unpublished.md)', source)).toBe('[n](https://github.com/org/repo/blob/main/unpublished.md)')
      expect(await resolver.rewriteLinks('[n](unpublished.md)', source)).toBe('[n](https://test.atlassian.net/wiki/spaces/EUDP/pages/456)')
    })

    it('looks a failed lookup up again', async () => {
      const findPageId = jest.fn().mockRejectedValueOnce(new Error('page lookup failed (HTTP 500)')).mockResolvedValueOnce('123')
      const { resolver } = makeResolver({ findPageId })
      await resolver.rewriteLinks('[p](sub%20dir/published%20page.md)', source)
      expect(await resolver.rewriteLinks('[p](sub%20dir/published%20page.md)', source)).toBe(`[p](${confluenceLink})`)
    })
  })
})
