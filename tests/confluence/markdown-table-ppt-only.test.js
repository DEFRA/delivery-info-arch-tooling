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

describe('markdown-to-atlas-doc inline PPT_ONLY tables', () => {
  it('renders a single table after stripping inline PPT_ONLY header repeats', () => {
    const content = `| Requirement | Pattern | Supplier |
|-------------|---------|----------|
| Row 1 | A | B |
<!-- PPT_ONLY -->
# cont
| Requirement | Pattern | Supplier |
|-------------|---------|----------|
<!-- /PPT_ONLY -->
| Row 2 | C | D |`

    const filtered = filterContentForFormat(content, 'confluence')
    const doc = convertMarkdown(filtered)
    const tables = doc.content.filter((node) => node.type === 'table')

    expect(tables).toHaveLength(1)
    expect(tables[0].content).toHaveLength(3)
  })
})
