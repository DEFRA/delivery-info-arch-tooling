const { filterContentByFormat, collapseBlankLinesInTables, normalizeDefraEmphasisForMarkdown } = require('../../lib/ppt/content-filters')

describe('content-filters', () => {
  describe('normalizeDefraEmphasisForMarkdown', () => {
    it('rewrites __italic__ to *italic* for Marp while preserving **bold**', () => {
      const input = '**INS** __(Import Notification Service)__ and __asynchronous__ ops'
      const result = normalizeDefraEmphasisForMarkdown(input)
      expect(result).toBe('**INS** *(Import Notification Service)* and *asynchronous* ops')
    })

    it('does not alter single-underscore emphasis', () => {
      const input = '_legacy italic_'
      expect(normalizeDefraEmphasisForMarkdown(input)).toBe(input)
    })
  })

  describe('filterContentByFormat (confluence)', () => {
    it('keeps one continuous table after removing inline PPT_ONLY header repeats', () => {
      const content = `| Requirement | Pattern |
|-------------|---------|
| Row 1 | A |
<!-- PPT_ONLY -->
# continued
| Requirement | Pattern |
|-------------|---------|
<!-- /PPT_ONLY -->
| Row 2 | B |`

      const result = filterContentByFormat(content, 'confluence')

      expect(result).not.toContain('PPT_ONLY')
      expect(result).not.toContain('# continued')
      expect(result).not.toMatch(/\| Row 1 \| A \|\n\n\| Row 2 \| B \|/)
      expect(result).toMatch(/\| Row 1 \| A \|\n\| Row 2 \| B \|/)
    })

    it('preserves blank lines between separate tables', () => {
      const content = `| H1 | H2 |
|----|----|
| a | b |

| H3 | H4 |
|----|----|
| c | d |`

      const result = collapseBlankLinesInTables(content)
      expect(result).toBe(content)
    })
  })
})
