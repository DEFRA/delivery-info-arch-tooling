/**
 * Extract diagram references from markdown for a target output format.
 * @module @defra/delivery-info-arch-tooling/ppt/diagram-refs
 */

const { readFileSync } = require('fs')
const { filterContentByFormat } = require('./content-filters')

const LIKEC4_REGEX = /<LikeC4View[^>]*viewId="([^"]+)"[^>]*\/?>/g
const MERMAID_REGEX = /<MermaidDiagram[^>]*diagramId="([^"]+)"[^>]*\/?>/g

function unique (values) {
  return [...new Set(values)]
}

/**
 * Extract LikeC4 and Mermaid diagram IDs from markdown content.
 * @param {string} content - Raw markdown content
 * @param {{ format?: string }} [options]
 * @returns {{ likeC4Views: string[], mermaidDiagrams: string[] }}
 */
function extractDiagramRefs (content, options = {}) {
  const format = options.format || 'ppt'
  const filtered = filterContentByFormat(content, format)

  const likeC4Views = []
  const mermaidDiagrams = []

  for (const match of filtered.matchAll(LIKEC4_REGEX)) {
    likeC4Views.push(match[1])
  }

  for (const match of filtered.matchAll(MERMAID_REGEX)) {
    mermaidDiagrams.push(match[1])
  }

  return {
    likeC4Views: unique(likeC4Views),
    mermaidDiagrams: unique(mermaidDiagrams)
  }
}

/**
 * Read a markdown file and extract diagram references for PPT output.
 * @param {string} inputFile
 * @param {{ format?: string }} [options]
 * @returns {{ likeC4Views: string[], mermaidDiagrams: string[] }}
 */
function extractDiagramRefsFromFile (inputFile, options = {}) {
  const content = readFileSync(inputFile, 'utf-8')
  return extractDiagramRefs(content, options)
}

module.exports = {
  extractDiagramRefs,
  extractDiagramRefsFromFile
}
