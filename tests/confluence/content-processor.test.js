/**
 * Unit tests for confluence/lib/content-processor.js
 */

const path = require('path')
const { spawn } = require('child_process')
const {
  readFileContent,
  filterContentForFormat,
  extractTitle,
  convertMarkdownToStorage,
  addWarningPanelToAtlas,
  addWarningPanelToContent
} = require('../../lib/confluence/lib/content-processor')

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    access: jest.fn()
  }
}))

const fs = require('fs')

jest.mock('child_process', () => ({
  spawn: jest.fn()
}))

describe('content-processor', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('readFileContent', () => {
    it('should read file content without frontmatter', async () => {
      const content = '# Title\n\nContent here'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await readFileContent('/path/to/file.md')
      expect(result).toBe(content)
    })

    it('should skip frontmatter if present', async () => {
      const content = '---\ntitle: Test\n---\n\n# Title\n\nContent here'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await readFileContent('/path/to/file.md')
      expect(result).toBe('# Title\n\nContent here')
    })

    it('should handle frontmatter with no closing', async () => {
      const content = '---\ntitle: Test\n# Title\n\nContent'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await readFileContent('/path/to/file.md')
      expect(result).toBe(content) // Should return as-is if no closing ---
    })

    it('should throw error if file read fails', async () => {
      fs.promises.readFile.mockRejectedValueOnce(new Error('File not found'))

      await expect(readFileContent('/path/to/file.md')).rejects.toThrow('Failed to read file')
    })
  })

  describe('filterContentForFormat', () => {
    it('should remove PPT_ONLY blocks for confluence format', () => {
      const content = 'Start\n<!-- PPT_ONLY -->\nPPT content\n<!-- /PPT_ONLY -->\nEnd'
      const result = filterContentForFormat(content, 'confluence')
      expect(result).not.toContain('PPT content')
      expect(result).toContain('Start')
      expect(result).toContain('End')
    })

    it('should remove GITHUB_ONLY blocks for confluence format', () => {
      const content = 'Start\n<!-- GITHUB_ONLY -->\nGitHub content\n<!-- /GITHUB_ONLY -->\nEnd'
      const result = filterContentForFormat(content, 'confluence')
      expect(result).not.toContain('GitHub content')
      expect(result).toContain('Start')
      expect(result).toContain('End')
    })

    it('should not leave a blank line that breaks a table when removing a PPT_ONLY block', () => {
      const content = [
        '| Col A | Col B |',
        '|-------|-------|',
        '<!-- PPT_ONLY -->',
        '| slide row | x |',
        '<!-- /PPT_ONLY -->',
        '| kept row | y |',
        ''
      ].join('\n')

      const result = filterContentForFormat(content, 'confluence')

      // A blank line here would terminate the table and render the
      // following row as literal pipes in Confluence
      expect(result).toBe('| Col A | Col B |\n|-------|-------|\n| kept row | y |\n')
    })

    it('should not leave a blank line that breaks a table when removing a GITHUB_ONLY block', () => {
      const content = [
        '| Col A | Col B |',
        '|-------|-------|',
        '<!-- GITHUB_ONLY -->',
        '| gh row | x |',
        '<!-- /GITHUB_ONLY -->',
        '| kept row | y |',
        ''
      ].join('\n')

      const result = filterContentForFormat(content, 'confluence')

      expect(result).toBe('| Col A | Col B |\n|-------|-------|\n| kept row | y |\n')
    })

    it('should remove each of several PPT_ONLY blocks without leaving blank lines', () => {
      const content = 'A\n<!-- PPT_ONLY -->\n1\n<!-- /PPT_ONLY -->\nB\n<!-- PPT_ONLY -->\n2\n<!-- /PPT_ONLY -->\nC\n'

      const result = filterContentForFormat(content, 'confluence')

      expect(result).toBe('A\nB\nC\n')
    })

    it('should preserve paragraph separation around a removed PPT_ONLY block', () => {
      const content = 'Para one.\n\n<!-- PPT_ONLY -->\nslide\n<!-- /PPT_ONLY -->\n\nPara two.\n'

      const result = filterContentForFormat(content, 'confluence')

      // Only one newline is consumed, so the surrounding paragraphs stay separate
      expect(result).toContain('Para one.')
      expect(result).toContain('Para two.')
      expect(result).toMatch(/Para one\.\n\s*\nPara two\./)
    })

    it('should remove CONFLUENCE_ONLY markers but keep content', () => {
      const content = 'Start\n<!-- CONFLUENCE_ONLY -->\nConfluence content\n<!-- /CONFLUENCE_ONLY -->\nEnd'
      const result = filterContentForFormat(content, 'confluence')
      expect(result).toContain('Confluence content')
      expect(result).not.toContain('CONFLUENCE_ONLY')
    })

    it('should remove Astro note blocks', () => {
      const content = 'Start\n:::note\nNote content\n:::\nEnd'
      const result = filterContentForFormat(content, 'confluence')
      expect(result).not.toContain('Note content')
      expect(result).toContain('Start')
      expect(result).toContain('End')
    })

    it('should return content unchanged for non-confluence formats', () => {
      const content = 'Some content\n<!-- PPT_ONLY -->\nPPT\n<!-- /PPT_ONLY -->'
      const result = filterContentForFormat(content, 'ppt')
      expect(result).toBe(content)
    })
  })

  describe('extractTitle', () => {
    it('should extract title from frontmatter', async () => {
      const content = '---\ntitle: "My Title"\n---\n\n# Content'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await extractTitle('/path/to/file.md')
      expect(result).toBe('My Title')
    })

    it('should extract title from frontmatter without quotes', async () => {
      const content = '---\ntitle: My Title\n---\n\n# Content'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await extractTitle('/path/to/file.md')
      expect(result).toBe('My Title')
    })

    it('should extract title from first H1 if no frontmatter', async () => {
      const content = '# My Title\n\nContent here'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await extractTitle('/path/to/file.md')
      expect(result).toBe('My Title')
    })

    it('should use filename as fallback', async () => {
      const content = 'No title here'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await extractTitle('/path/to/my-file.md')
      expect(result).toBe('my file')
    })

    it('should handle ADR filenames', async () => {
      const content = 'No title'
      fs.promises.readFile.mockResolvedValueOnce(content)

      const result = await extractTitle('/path/to/adr-001.md')
      // The function replaces "-" with " " then adds "ADR-" prefix, resulting in "ADR- 001"
      expect(result).toBe('ADR- 001')
    })

    it('should handle read errors gracefully', async () => {
      fs.promises.readFile.mockRejectedValueOnce(new Error('Read failed'))

      const result = await extractTitle('/path/to/file.md')
      expect(result).toBe('file')
    })
  })

  describe('convertMarkdownToStorage', () => {
    it('should convert headers', () => {
      const content = '# H1\n## H2\n### H3'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<h1>H1</h1>')
      expect(result).toContain('<h2>H2</h2>')
      expect(result).toContain('<h3>H3</h3>')
    })

    it('should convert bold text', () => {
      const content = 'This is **bold** text'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<strong>bold</strong>')
    })

    it('should convert italic text', () => {
      const content = 'This is *italic* text'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<em>italic</em>')
    })

    it('should convert code blocks', () => {
      const content = '```\ncode here\n```'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<ac:structured-macro ac:name="code"')
      expect(result).toContain('code here')
    })

    it('should convert inline code', () => {
      const content = 'Use `code()` function'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<code>code()</code>')
    })

    it('should convert links', () => {
      const content = '[Link text](https://example.com)'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<a href="https://example.com">Link text</a>')
    })

    it('should convert paragraphs', () => {
      const content = 'First paragraph\n\nSecond paragraph'
      const result = convertMarkdownToStorage(content)
      expect(result).toContain('<p>First paragraph</p>')
      expect(result).toContain('<p>Second paragraph</p>')
    })
  })

  describe('addWarningPanelToAtlas', () => {
    it('should add warning panel to Atlas document', () => {
      const atlasDoc = {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Content' }] }
        ]
      }
      const githubUrl = 'https://github.com/defra/repo/file.md'

      const result = addWarningPanelToAtlas(atlasDoc, githubUrl)

      expect(result.content).toHaveLength(2)
      expect(result.content[0].type).toBe('panel')
      expect(result.content[0].attrs.panelType).toBe('warning')
      expect(result.content[0].content[0].content[1].marks[0].attrs.href).toBe(githubUrl)
    })

    it('should parse string JSON', () => {
      const atlasJson = JSON.stringify({
        type: 'doc',
        content: []
      })
      const githubUrl = 'https://github.com/defra/repo/file.md'

      const result = addWarningPanelToAtlas(atlasJson, githubUrl)

      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('panel')
    })

    it('should return unchanged if no GitHub URL', () => {
      const atlasDoc = {
        type: 'doc',
        content: []
      }

      const result = addWarningPanelToAtlas(atlasDoc, null)
      expect(result).toBe(atlasDoc)
    })

    it('should handle empty content array', () => {
      const atlasDoc = {
        type: 'doc',
        content: []
      }
      const githubUrl = 'https://github.com/defra/repo/file.md'

      const result = addWarningPanelToAtlas(atlasDoc, githubUrl)
      expect(result.content).toHaveLength(1)
    })
  })

  describe('addWarningPanelToContent', () => {
    it('should add warning panel after first H1', () => {
      const content = '# Title\n\nContent here'
      const githubUrl = 'https://github.com/defra/repo/file.md'

      const result = addWarningPanelToContent(content, githubUrl, false)

      expect(result).toContain('ac:structured-macro ac:name="warning"')
      expect(result).toContain(githubUrl)
      expect(result.indexOf('# Title')).toBeLessThan(result.indexOf('warning'))
    })

    it('should add warning panel at beginning if no H1', () => {
      const content = 'Content without heading'
      const githubUrl = 'https://github.com/defra/repo/file.md'

      const result = addWarningPanelToContent(content, githubUrl, false)

      expect(result).toContain('ac:structured-macro ac:name="warning"')
      expect(result.indexOf('warning')).toBeLessThan(result.indexOf('Content'))
    })

    it('should return unchanged if no GitHub URL', () => {
      const content = '# Title\n\nContent'
      const result = addWarningPanelToContent(content, null, false)
      expect(result).toBe(content)
    })

    it('should return unchanged for Atlas format', () => {
      const content = '# Title\n\nContent'
      const githubUrl = 'https://github.com/defra/repo/file.md'
      const result = addWarningPanelToContent(content, githubUrl, true)
      expect(result).toBe(content)
    })
  })
})
