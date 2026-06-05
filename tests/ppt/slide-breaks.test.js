const { applyPptSlideMarkers } = require('../../lib/ppt/slide-breaks')
const { filterContentByFormat } = require('../../lib/ppt/content-filters')

describe('PPT_SLIDE marker', () => {
  it('inserts a Marp slide break without keeping the marker', () => {
    const content = `### Overview slide

Some text

<!-- PPT_SLIDE -->
### Diagram slide

![diagram](./diagram.png)
`

    const marp = applyPptSlideMarkers(content)

    expect(marp).not.toContain('PPT_SLIDE')
    expect(marp).toContain('---')
    expect(marp).toContain('<!-- fit -->')
    expect(marp).toContain('### Diagram slide')
  })

  it('is removed from GitHub and Confluence output', () => {
    const content = `### Overview

<!-- PPT_SLIDE -->
### Diagram
`

    expect(filterContentByFormat(content, 'github')).not.toContain('PPT_SLIDE')
    expect(filterContentByFormat(content, 'confluence')).not.toContain('PPT_SLIDE')
  })

  it('is preserved for PPT processing before slide conversion', () => {
    const content = `### Overview

<!-- PPT_SLIDE -->
### Diagram
`

    expect(filterContentByFormat(content, 'ppt')).toContain('PPT_SLIDE')
  })
})
