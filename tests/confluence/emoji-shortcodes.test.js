/**
 * Emoji shortcode replacement for Confluence publish.
 */

const { spawnSync } = require('child_process')
const path = require('path')
const { replaceEmojiShortcodes } = require('../../lib/confluence/emoji-shortcodes')
const { convertMarkdownToStorage } = require('../../lib/confluence/lib/content-processor')

const atlasScript = path.join(__dirname, '../../lib/confluence/markdown-to-atlas-doc.js')

function toAtlas (markdown) {
  const result = spawnSync(process.execPath, [atlasScript], {
    input: markdown,
    encoding: 'utf8'
  })
  expect(result.status).toBe(0)
  return JSON.parse(result.stdout)
}

function headingText (doc) {
  const heading = doc.content.find(node => node.type === 'heading')
  return heading.content.map(node => node.text).join('')
}

describe('replaceEmojiShortcodes', () => {
  it('replaces a known GitHub shortcode with its emoji', () => {
    expect(replaceEmojiShortcodes(':arrows_clockwise: Dependencies'))
      .toBe('🔃 Dependencies')
  })

  it('replaces shortcodes in running text and accepts :+1:', () => {
    expect(replaceEmojiShortcodes('Ship it :+1: today'))
      .toBe('Ship it 👍 today')
  })

  it('leaves unknown colon tokens and times unchanged', () => {
    const input = 'See :box: at 09:12:04 and :not_an_emoji:.'
    expect(replaceEmojiShortcodes(input)).toBe(input)
  })

  it('does not rewrite the type token of a :box: macro', () => {
    const input = ':box:warning:Scope note:Check :arrows_clockwise: before publish.:'
    expect(replaceEmojiShortcodes(input))
      .toBe(':box:warning:Scope note:Check 🔃 before publish.:')
  })

  it('leaves shortcodes inside code and comments unchanged', () => {
    const input = [
      'Use `:arrows_clockwise:` in prose.',
      '',
      '```',
      ':arrows_clockwise:',
      '```',
      '',
      '<!-- Macro: :arrows_clockwise: -->',
      '',
      ':arrows_clockwise:'
    ].join('\n')

    expect(replaceEmojiShortcodes(input)).toBe([
      'Use `:arrows_clockwise:` in prose.',
      '',
      '```',
      ':arrows_clockwise:',
      '```',
      '',
      '<!-- Macro: :arrows_clockwise: -->',
      '',
      '🔃'
    ].join('\n'))
  })
})

describe('confluence converters', () => {
  it('puts the emoji in storage-format headings', () => {
    const result = convertMarkdownToStorage('# :arrows_clockwise: Dependencies')
    expect(result).toContain('<h1>🔃 Dependencies</h1>')
  })

  it('puts the emoji in an Atlas doc heading', () => {
    const doc = toAtlas('# :arrows_clockwise: Dependencies\n')
    expect(headingText(doc)).toBe('🔃 Dependencies')
  })
})
