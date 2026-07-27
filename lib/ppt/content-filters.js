/**
 * Format-specific content filters shared by PPT generation and diagram extraction.
 * @module @defra/delivery-info-arch-tooling/ppt/content-filters
 */

function removeAstroComponents (content) {
  let filtered = content

  filtered = filtered.replace(/:::note\[[^\]]*\]\s*\n[\s\S]*?:::/g, '')
  filtered = filtered.replace(/:::(?:warning|tip|info|danger|caution)\[?[^\]]*\]?\s*\n[\s\S]*?:::/g, '')
  filtered = filtered.replace(/:::[^\n]*\n[\s\S]*?:::/g, '')

  return filtered
}

function isTableSeparator (line) {
  return /^\s*\|?[\s\-:|]+\|?\s*$/.test(line)
}

function isTableRow (line) {
  return typeof line === 'string' && line.includes('|') && !isTableSeparator(line)
}

/**
 * Remove blank lines sandwiched between markdown table rows.
 * After stripping inline PPT_ONLY header repeats, a blank line would otherwise
 * split one logical table into fragments in Confluence.
 */
/**
 * Defra docs convention: **bold**, __italic__ (not CommonMark, where __ is also bold).
 * Rewrites __italic__ to *italic* for Markdown renderers (e.g. Marp) that follow CommonMark.
 */
function normalizeDefraEmphasisForMarkdown (content) {
  const placeholders = new Map()
  let i = 0
  let result = content

  result = result.replace(/\*\*([^*]+)\*\*/g, (match) => {
    const id = `\u0000DEFRA_BOLD_${i++}\u0000`
    placeholders.set(id, match)
    return id
  })

  result = result.replace(/__([^_\n]+?)__/g, (_, text) => `*${text}*`)

  for (const [id, original] of placeholders) {
    result = result.split(id).join(original)
  }

  return result
}

function collapseBlankLinesInTables (content) {
  const lines = content.split('\n')
  const out = []

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() && out.length > 0) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++

      const prev = out[out.length - 1]
      const next = j < lines.length ? lines[j] : ''
      const afterNext = j + 1 < lines.length ? lines[j + 1] : ''
      const nextStartsNewTable = isTableRow(next) && isTableSeparator(afterNext)

      if (isTableRow(prev) && isTableRow(next) && !nextStartsNewTable) {
        continue
      }
    }

    out.push(lines[i])
  }

  return out.join('\n')
}

function filterContentByFormat (content, targetFormat) {
  let filtered = content

  if (targetFormat === 'ppt' || targetFormat === 'marp') {
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = removeAstroComponents(filtered)
    filtered = filtered.replace(/[ \t]*<figcaption>[\s\S]*?<\/figcaption>[ \t]*\r?\n?/gi, '')
  } else if (targetFormat === 'confluence') {
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '')
    filtered = removeAstroComponents(filtered)
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_SLIDE\s*-->[ \t]*\r?\n/gm, '')
    filtered = collapseBlankLinesInTables(filtered)
  } else if (targetFormat === 'github' || targetFormat === 'astro') {
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '')
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_SLIDE\s*-->[ \t]*\r?\n/gm, '')
  }

  return filtered
}

module.exports = {
  removeAstroComponents,
  normalizeDefraEmphasisForMarkdown,
  collapseBlankLinesInTables,
  isTableRow,
  isTableSeparator,
  filterContentByFormat
}
