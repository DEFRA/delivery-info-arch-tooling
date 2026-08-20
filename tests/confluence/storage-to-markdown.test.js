/**
 * Unit tests for confluence/storage-to-markdown.js
 */

const { convert, decodeEntities, plainText } = require('../../lib/confluence/storage-to-markdown')

describe('storage-to-markdown', () => {
  describe('decodeEntities', () => {
    it('should decode named entities', () => {
      expect(decodeEntities('fish &amp; chips &ndash; &pound;5')).toBe('fish & chips – £5')
    })

    it('should decode numeric and hex entities', () => {
      expect(decodeEntities('&#65;&#x42;')).toBe('AB')
    })

    it('should leave unknown entities alone', () => {
      expect(decodeEntities('&unknown;')).toBe('&unknown;')
    })

    it('should drop out-of-range code points', () => {
      expect(decodeEntities('&#x110000;')).toBe('')
    })
  })

  describe('plainText', () => {
    it('should strip tags and collapse whitespace', () => {
      expect(plainText('<p>Hello   <strong>world</strong></p>')).toBe('Hello world')
    })
  })

  describe('convert', () => {
    it('should return empty string for empty input', () => {
      expect(convert('')).toBe('')
      expect(convert(null)).toBe('')
    })

    it('should convert headings', () => {
      expect(convert('<h1>Title</h1><h2>Sub</h2>')).toBe('# Title\n\n## Sub\n')
    })

    it('should convert paragraphs and inline formatting', () => {
      expect(convert('<p>Some <strong>bold</strong> and <em>italic</em> and <code>code</code></p>'))
        .toBe('Some **bold** and *italic* and `code`\n')
    })

    it('should convert strikethrough', () => {
      expect(convert('<p><del>gone</del></p>')).toBe('~~gone~~\n')
    })

    it('should convert links', () => {
      expect(convert('<p><a href="https://gov.uk">GOV.UK</a></p>')).toBe('[GOV.UK](https://gov.uk)\n')
    })

    it('should convert br and hr', () => {
      expect(convert('<p>one<br/>two</p>')).toBe('one\\\ntwo\n')
      expect(convert('<p>a</p><hr/><p>b</p>')).toBe('a\n\n---\n\nb\n')
    })

    it('should convert unordered and ordered lists', () => {
      expect(convert('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two\n')
      expect(convert('<ol><li>first</li><li>second</li></ol>')).toBe('1. first\n2. second\n')
    })

    it('should convert nested lists', () => {
      const storage = '<ul><li>outer<ul><li>inner</li></ul></li></ul>'
      expect(convert(storage)).toBe('- outer\n\n    - inner\n')
    })

    it('should convert tables with headers', () => {
      const storage = '<table><tbody>' +
        '<tr><th>Name</th><th>Value</th></tr>' +
        '<tr><td>a</td><td>1</td></tr>' +
        '</tbody></table>'
      expect(convert(storage)).toBe('| Name | Value |\n| --- | --- |\n| a | 1 |\n')
    })

    it('should escape pipes inside table cells', () => {
      const storage = '<table><tbody><tr><th>Col</th></tr><tr><td>a|b</td></tr></tbody></table>'
      expect(convert(storage)).toContain('a\\|b')
    })

    it('should convert blockquotes', () => {
      expect(convert('<blockquote><p>quoted</p></blockquote>')).toBe('> quoted\n')
    })

    it('should convert code macros with language', () => {
      const storage = '<ac:structured-macro ac:name="code">' +
        '<ac:parameter ac:name="language">javascript</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[const x = 1 < 2]]></ac:plain-text-body>' +
        '</ac:structured-macro>'
      expect(convert(storage)).toBe('```javascript\nconst x = 1 < 2\n```\n')
    })

    it('should convert panel macros to labelled blockquotes', () => {
      const storage = '<ac:structured-macro ac:name="info">' +
        '<ac:rich-text-body><p>Heads up</p></ac:rich-text-body>' +
        '</ac:structured-macro>'
      expect(convert(storage)).toBe('> ℹ️ **Info**\n>\n> Heads up\n')
    })

    it('should convert expand macros to details blocks', () => {
      const storage = '<ac:structured-macro ac:name="expand">' +
        '<ac:parameter ac:name="title">More</ac:parameter>' +
        '<ac:rich-text-body><p>Hidden</p></ac:rich-text-body>' +
        '</ac:structured-macro>'
      const markdown = convert(storage)
      expect(markdown).toContain('<summary>More</summary>')
      expect(markdown).toContain('Hidden')
    })

    it('should keep the body of unknown macros', () => {
      const storage = '<ac:structured-macro ac:name="mystery">' +
        '<ac:rich-text-body><p>Do not lose this</p></ac:rich-text-body>' +
        '</ac:structured-macro>'
      const markdown = convert(storage)
      expect(markdown).toContain('<!-- macro: mystery -->')
      expect(markdown).toContain('Do not lose this')
    })

    it('should convert page links to confluence: references', () => {
      const storage = '<ac:link><ri:page ri:space-key="EUDP" ri:content-title="Target Page" />' +
        '<ac:plain-text-link-body><![CDATA[the target]]></ac:plain-text-link-body></ac:link>'
      expect(convert(storage)).toBe('[the target](confluence:EUDP/Target Page)')
    })

    it('should convert attachment images', () => {
      const storage = '<ac:image ac:alt="diagram"><ri:attachment ri:filename="context.png" /></ac:image>'
      expect(convert(storage)).toBe('![diagram](attachment:context.png)')
    })

    it('should convert task lists to checklists', () => {
      const storage = '<ac:task-list>' +
        '<ac:task><ac:task-status>complete</ac:task-status><ac:task-body>done thing</ac:task-body></ac:task>' +
        '<ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>todo thing</ac:task-body></ac:task>' +
        '</ac:task-list>'
      expect(convert(storage)).toBe('- [x] done thing\n- [ ] todo thing\n')
    })

    it('should convert status macros', () => {
      const storage = '<ac:structured-macro ac:name="status">' +
        '<ac:parameter ac:name="title">In Progress</ac:parameter>' +
        '<ac:parameter ac:name="colour">Yellow</ac:parameter>' +
        '</ac:structured-macro>'
      expect(convert(storage)).toBe('`[IN PROGRESS / Yellow]`')
    })

    it('should replace toc and children macros with comments', () => {
      expect(convert('<ac:structured-macro ac:name="toc"></ac:structured-macro>'))
        .toBe('<!-- Confluence table of contents -->\n')
      expect(convert('<ac:structured-macro ac:name="children"></ac:structured-macro>'))
        .toBe('<!-- Confluence child-pages macro -->\n')
    })

    it('should strip layout wrappers but keep their content', () => {
      const storage = '<ac:layout><ac:layout-section><ac:layout-cell><p>content</p></ac:layout-cell></ac:layout-section></ac:layout>'
      expect(convert(storage)).toBe('content\n')
    })

    it('should escape markdown control characters in text', () => {
      expect(convert('<p>a*b_c[d]</p>')).toBe('a\\*b\\_c\\[d\\]\n')
    })

    it('should collapse runs of blank lines', () => {
      const markdown = convert('<p>one</p><p></p><p></p><p>two</p>')
      expect(markdown).not.toMatch(/\n{3,}/)
    })
  })
})
