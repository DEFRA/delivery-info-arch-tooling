const { spawnSync } = require('child_process')
const path = require('path')
const { filterContentForFormat } = require('../../lib/confluence/lib/content-processor')

const converterPath = path.join(__dirname, '../../lib/confluence/markdown-to-atlas-doc.js')

function convertMarkdown (markdown) {
  const result = spawnSync('node', [converterPath], { input: markdown, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || 'converter failed')
  }
  return JSON.parse(result.stdout)
}

function childrenMacros (doc) {
  return doc.content.filter((node) => node.type === 'extension' && node.attrs.extensionKey === 'children')
}

describe('markdown-to-atlas-doc CONFLUENCE_CHILDREN', () => {
  it('turns a CONFLUENCE_CHILDREN line into a Children Display macro listing every child', () => {
    const doc = convertMarkdown('## Scenario List\n\n<!-- CONFLUENCE_CHILDREN -->\n')
    const macros = childrenMacros(doc)

    expect(macros).toHaveLength(1)
    expect(macros[0].attrs.extensionType).toBe('com.atlassian.confluence.macro.core')
    expect(macros[0].attrs.parameters.macroParams.allChildren).toEqual({ value: 'true' })
    expect(JSON.stringify(doc)).not.toContain('CONFLUENCE_CHILDREN')
  })

  it('closes an open list before the macro', () => {
    const doc = convertMarkdown('- one\n- two\n<!-- CONFLUENCE_CHILDREN -->\n')
    const types = doc.content.map((node) => node.type)

    expect(types).toEqual(['bulletList', 'extension'])
  })

  it('replaces a GITHUB_ONLY link list with the macro on Confluence', () => {
    const content = '## Scenario List\n\n<!-- GITHUB_ONLY -->\n- [Scenario 0](s0.md)\n<!-- /GITHUB_ONLY -->\n\n<!-- CONFLUENCE_CHILDREN -->\n'
    const doc = convertMarkdown(filterContentForFormat(content, 'confluence'))

    expect(doc.content.some((node) => node.type === 'bulletList')).toBe(false)
    expect(childrenMacros(doc)).toHaveLength(1)
  })
})
