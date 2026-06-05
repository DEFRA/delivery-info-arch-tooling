const { extractDiagramRefs } = require('../../lib/ppt/diagram-refs')

describe('extractDiagramRefs', () => {
  it('extracts LikeC4 and Mermaid diagram IDs from PPT-visible content', () => {
    const content = `
# Overview

<LikeC4View viewId="tracesGatewaySystemContext" />

<!-- GITHUB_ONLY -->
<MermaidDiagram diagramId="github-only-diagram" />
<!-- /GITHUB_ONLY -->

<MermaidDiagram diagramId="document-retrieval-sync" width="900" />
`

    const refs = extractDiagramRefs(content, { format: 'ppt' })

    expect(refs.likeC4Views).toEqual(['tracesGatewaySystemContext'])
    expect(refs.mermaidDiagrams).toEqual(['document-retrieval-sync'])
  })

  it('includes diagrams inside PPT_ONLY blocks', () => {
    const content = `
<!-- PPT_ONLY -->
<LikeC4View viewId="pptOnlyView" />
<!-- /PPT_ONLY -->
`

    const refs = extractDiagramRefs(content, { format: 'ppt' })

    expect(refs.likeC4Views).toEqual(['pptOnlyView'])
  })

  it('excludes diagrams inside NOT_PPT blocks', () => {
    const content = `
<!-- NOT_PPT -->
<MermaidDiagram diagramId="hidden-diagram" />
<!-- /NOT_PPT -->
`

    const refs = extractDiagramRefs(content, { format: 'ppt' })

    expect(refs.mermaidDiagrams).toEqual([])
  })
})
