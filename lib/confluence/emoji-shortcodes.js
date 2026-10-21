/**
 * Replace GitHub emoji shortcodes with Unicode emoji.
 *
 * The map is the gemoji alias list (https://github.com/github/gemoji).
 * Unknown :tokens: are left unchanged, so :box: macros and times such as
 * 09:12:04 are not rewritten. :box:<type>: is masked first because some
 * panel types (warning) are also emoji names.
 *
 * @module @defra/delivery-info-arch-tooling/confluence/emoji-shortcodes
 */

const shortcodes = require('./emoji-shortcodes.json')

/**
 * Hide a span from the shortcode pass, then restore it afterwards.
 * @param {string[]} masks
 * @returns {(text: string) => string}
 */
function maskWith (masks) {
  return (text) => {
    const token = `\u0000E${masks.length}\u0000`
    masks.push(text)
    return token
  }
}

/**
 * Turn :shortcode: into the matching emoji.
 * Skips fenced code, inline code, HTML comments, and the type token of a :box: macro.
 * @param {string} markdown
 * @returns {string}
 */
function replaceEmojiShortcodes (markdown) {
  if (!markdown) return markdown

  const masks = []
  const mask = maskWith(masks)
  let text = String(markdown)

  text = text.replace(/```[\s\S]*?```/g, mask)
  text = text.replace(/`[^`\n]*`/g, mask)
  text = text.replace(/<!--[\s\S]*?-->/g, mask)
  text = text.replace(/:box:[^:\s]+:/g, mask)

  text = text.replace(/:([a-z0-9_+-]+):/gi, (match, name) => {
    return shortcodes[name.toLowerCase()] || match
  })

  return text.replace(/\u0000E(\d+)\u0000/g, (_, index) => masks[Number(index)])
}

module.exports = {
  replaceEmojiShortcodes
}
