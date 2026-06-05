/**
 * Slide-break helpers for PPT/Marp conversion.
 * @module @defra/delivery-info-arch-tooling/ppt/slide-breaks
 */

const PPT_SLIDE_MARKER = /<!--\s*PPT_SLIDE\s*-->/i

function applyPptSlideMarkers (content) {
  const lines = content.split('\n')
  const result = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.match(PPT_SLIDE_MARKER)) {
      if (result.length > 0 && !result[result.length - 1].match(/^---\s*$/)) {
        result.push('<!-- _backgroundColor: #ffffff -->')
        result.push('---')
        result.push('')
        result.push('<!-- fit -->')
        result.push('')
      }
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

module.exports = {
  PPT_SLIDE_MARKER,
  applyPptSlideMarkers
}
