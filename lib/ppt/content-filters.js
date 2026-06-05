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
  filterContentByFormat
}
