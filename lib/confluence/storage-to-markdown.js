/**
 * Convert Confluence storage-format XHTML into Markdown.
 *
 * Deliberately dependency-free: the publish side of this toolkit already
 * owns markdown -> ADF, this is the inverse for the read side.
 *
 * @module @defra/delivery-info-arch-tooling/confluence/storage-to-markdown
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  times: '×',
  pound: '£',
  euro: '€',
  copy: '©',
  reg: '®',
  deg: '°',
  rarr: '→',
  larr: '←',
  check: '✓'
}

const PANEL_MACROS = {
  info: 'ℹ️ **Info**',
  note: '📝 **Note**',
  tip: '💡 **Tip**',
  warning: '⚠️ **Warning**',
  panel: '**Panel**'
}

/**
 * Decode XML/HTML entities, including numeric ones.
 * @param {string} text - Raw text
 * @returns {string} Decoded text
 */
function decodeEntities (text) {
  return String(text)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name) => {
      const key = name.toLowerCase()
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key)
        ? NAMED_ENTITIES[key]
        : match
    })
}

/**
 * Turn a code point into a character, tolerating malformed input.
 * @param {number} code - Unicode code point
 * @returns {string} Character, or empty string when out of range
 */
function safeCodePoint (code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch (e) {
    return ''
  }
}

/**
 * Read an attribute off an opening tag.
 * @param {string} tag - The full opening tag text
 * @param {string} name - Attribute name (may include a namespace prefix)
 * @returns {string|null} Attribute value, or null when absent
 */
function attr (tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\s${escaped}\\s*=\\s*"([^"]*)"`, 'i')) ||
    tag.match(new RegExp(`\\s${escaped}\\s*=\\s*'([^']*)'`, 'i'))
  return match ? decodeEntities(match[1]) : null
}

/**
 * Strip every tag from a fragment, leaving decoded plain text.
 * @param {string} html - Fragment
 * @returns {string} Plain text
 */
function plainText (html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Escape Markdown control characters that would otherwise change meaning.
 * @param {string} text - Plain text
 * @returns {string} Escaped text
 */
function escapeMarkdown (text) {
  return text.replace(/([\\`*_[\]])/g, '\\$1')
}

/**
 * Collapse a fragment to single-line Markdown, for use inside table cells.
 * @param {string} html - Fragment
 * @returns {string} Single-line Markdown
 */
function inlineCell (html) {
  return convert(html)
    .replace(/\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the text of a CDATA-or-plain body element.
 * @param {string} html - Fragment containing the body element
 * @param {string} tagName - Element name to look for
 * @returns {string} Body text
 */
function bodyText (html, tagName) {
  const match = html.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'))
  if (!match) return ''
  const inner = match[1]
  const cdata = inner.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return cdata ? cdata[1] : decodeEntities(inner.replace(/<[^>]*>/g, ''))
}

/**
 * Read the parameters of a structured macro into a plain object.
 * @param {string} html - Macro inner XHTML
 * @returns {Object} Parameter name -> value
 */
function macroParams (html) {
  const params = {}
  const re = /<ac:parameter[^>]*ac:name\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/ac:parameter>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    params[match[1]] = plainText(match[2])
  }
  return params
}

/**
 * Indent a block of text by a number of spaces, skipping blank lines.
 * @param {string} text - Block text
 * @param {number} spaces - Indent width
 * @returns {string} Indented text
 */
function indent (text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map(line => (line.trim() ? pad + line : line)).join('\n')
}

/**
 * Convert an ac:structured-macro element into Markdown.
 * @param {string} name - Macro name
 * @param {string} inner - Macro inner XHTML
 * @returns {string} Markdown
 */
function convertMacro (name, inner) {
  const key = String(name).toLowerCase()
  const params = macroParams(inner)

  if (key === 'code') {
    const lang = params.language && params.language !== 'none' ? params.language : ''
    const code = bodyText(inner, 'ac:plain-text-body').replace(/\s+$/, '')
    const title = params.title ? `**${params.title}**\n\n` : ''
    return `\n\n${title}\`\`\`${lang}\n${code}\n\`\`\`\n\n`
  }

  if (key === 'noformat') {
    return `\n\n\`\`\`\n${bodyText(inner, 'ac:plain-text-body').replace(/\s+$/, '')}\n\`\`\`\n\n`
  }

  if (Object.prototype.hasOwnProperty.call(PANEL_MACROS, key)) {
    const label = params.title ? `**${params.title}**` : PANEL_MACROS[key]
    const body = convert(stripMacroScaffolding(inner)).trim()
    const quoted = `${label}\n\n${body}`.split('\n')
      .map(line => `> ${line}`.replace(/\s+$/, ''))
      .join('\n')
    return `\n\n${quoted}\n\n`
  }

  if (key === 'expand') {
    const title = params.title || 'Details'
    const body = convert(stripMacroScaffolding(inner)).trim()
    return `\n\n<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>\n\n`
  }

  if (key === 'status') {
    const colour = params.colour || params.color
    return `\`[${(params.title || 'status').toUpperCase()}${colour ? ` / ${colour}` : ''}]\``
  }

  if (key === 'toc') return '\n\n<!-- Confluence table of contents -->\n\n'

  if (key === 'jira') {
    return params.key ? `[${params.key}](https://eaflood.atlassian.net/browse/${params.key})` : '`[jira macro]`'
  }

  if (key === 'children') return '\n\n<!-- Confluence child-pages macro -->\n\n'

  if (key === 'anchor') return ''

  if (key === 'drawio' || key === 'gliffy') {
    return `\n\n<!-- ${key} diagram: ${params.diagramName || params.name || 'unnamed'} -->\n\n`
  }

  // Unknown macro: keep any rich body so no prose is silently lost.
  const rich = stripMacroScaffolding(inner)
  const body = convert(rich).trim()
  const paramNote = Object.keys(params).length
    ? ` ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(', ')}`
    : ''
  return body
    ? `\n\n<!-- macro: ${key}${paramNote} -->\n\n${body}\n\n`
    : `\n\n<!-- macro: ${key}${paramNote} -->\n\n`
}

/**
 * Remove macro parameter/body scaffolding so only rich content remains.
 * @param {string} inner - Macro inner XHTML
 * @returns {string} Rich content
 */
function stripMacroScaffolding (inner) {
  return String(inner)
    .replace(/<ac:parameter[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<\/?ac:rich-text-body[^>]*>/gi, '')
    .replace(/<ac:plain-text-body[\s\S]*?<\/ac:plain-text-body>/gi, '')
}

/**
 * Convert an ac:link element into Markdown.
 * @param {string} inner - Link inner XHTML
 * @returns {string} Markdown link
 */
function convertAcLink (inner) {
  const pageMatch = inner.match(/<ri:page\b[^>]*>/i)
  const userMatch = inner.match(/<ri:user\b[^>]*>/i)
  const attachmentMatch = inner.match(/<ri:attachment\b[^>]*>/i)
  const rawBody = (inner.match(/<ac:(?:plain-text-)?link-body[^>]*>([\s\S]*?)<\/ac:(?:plain-text-)?link-body>/i) || [])[1] || ''
  // Plain-text bodies arrive CDATA-wrapped; unwrap before stripping tags or
  // the whole body is mistaken for a tag and the label is lost.
  const cdata = rawBody.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  const label = cdata ? cdata[1].trim() : plainText(rawBody)

  if (pageMatch) {
    const title = attr(pageMatch[0], 'ri:content-title') || label || 'page'
    const space = attr(pageMatch[0], 'ri:space-key')
    return `[${label || title}](confluence:${space ? `${space}/` : ''}${title})`
  }
  if (attachmentMatch) {
    const filename = attr(attachmentMatch[0], 'ri:filename') || label || 'attachment'
    return `[${label || filename}](attachment:${filename})`
  }
  if (userMatch) {
    return `@${label || attr(userMatch[0], 'ri:account-id') || 'user'}`
  }
  return label
}

/**
 * Convert an ac:image element into Markdown.
 * @param {string} inner - Image inner XHTML
 * @param {string} openTag - The opening tag, for alt text
 * @returns {string} Markdown image
 */
function convertAcImage (inner, openTag) {
  const alt = attr(openTag, 'ac:alt') || ''
  const attachment = inner.match(/<ri:attachment\b[^>]*>/i)
  const url = inner.match(/<ri:url\b[^>]*>/i)
  if (attachment) {
    return `![${alt}](attachment:${attr(attachment[0], 'ri:filename') || 'image'})`
  }
  if (url) {
    return `![${alt}](${attr(url[0], 'ri:value') || ''})`
  }
  return alt ? `![${alt}]()` : ''
}

/**
 * Convert a <table> element into a GitHub-flavoured Markdown table.
 * @param {string} html - Table inner XHTML
 * @returns {string} Markdown table
 */
function convertTable (html) {
  const rows = []
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = []
    let headerRow = false
    const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi
    let cellMatch
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      if (cellMatch[1].toLowerCase() === 'th') headerRow = true
      cells.push(inlineCell(cellMatch[2]))
    }
    if (cells.length) rows.push({ cells, headerRow })
  }

  if (!rows.length) return ''

  const width = Math.max(...rows.map(r => r.cells.length))
  const pad = cells => {
    const padded = cells.slice()
    while (padded.length < width) padded.push('')
    return `| ${padded.join(' | ')} |`
  }

  const lines = []
  const hasHeader = rows[0].headerRow
  const header = hasHeader ? rows[0] : { cells: Array(width).fill('') }
  lines.push(pad(header.cells))
  lines.push(`| ${Array(width).fill('---').join(' | ')} |`)
  for (const row of rows.slice(hasHeader ? 1 : 0)) lines.push(pad(row.cells))

  return `\n\n${lines.join('\n')}\n\n`
}

/**
 * Convert a list element into Markdown.
 * @param {string} html - List inner XHTML
 * @param {boolean} ordered - Whether the list is ordered
 * @param {number} depth - Nesting depth, for indentation
 * @returns {string} Markdown list
 */
function convertList (html, ordered, depth) {
  const items = []
  // Walk top-level <li> only. A non-greedy regex would stop at the first
  // </li> of a *nested* list, so match open/close pairs by depth instead.
  const openRe = /<li(?:\s[^>]*)?>/gi
  let cursor = 0
  let index = 1
  for (;;) {
    openRe.lastIndex = cursor
    const open = openRe.exec(html)
    if (!open) break
    const element = matchElement(html, 'li', open.index + open[0].length)
    if (!element) break
    cursor = element.end

    const marker = ordered ? `${index}. ` : '- '
    const body = convert(element.inner, depth + 1).trim()
    if (!body) { index++; continue }
    const [first, ...rest] = body.split('\n')
    const continuation = rest.length
      ? '\n' + indent(rest.join('\n'), marker.length)
      : ''
    items.push(`${marker}${first}${continuation}`)
    index++
  }
  if (!items.length) return ''
  const block = items.join('\n')
  return `\n\n${depth > 0 ? indent(block, 2) : block}\n\n`
}

/**
 * Convert an ac:task-list element into a Markdown checklist.
 * @param {string} html - Task list inner XHTML
 * @returns {string} Markdown checklist
 */
function convertTaskList (html) {
  const items = []
  const re = /<ac:task>([\s\S]*?)<\/ac:task>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    const done = /<ac:task-status>\s*complete\s*<\/ac:task-status>/i.test(match[1])
    const body = inlineCell((match[1].match(/<ac:task-body[^>]*>([\s\S]*?)<\/ac:task-body>/i) || [])[1] || '')
    items.push(`- [${done ? 'x' : ' '}] ${body}`)
  }
  return items.length ? `\n\n${items.join('\n')}\n\n` : ''
}

/**
 * Find the matching close tag for an opening tag, honouring nesting.
 * @param {string} html - Full source
 * @param {string} tagName - Tag name
 * @param {number} from - Index just past the opening tag
 * @returns {{inner: string, end: number}|null} Inner content and index past the close tag
 */
function matchElement (html, tagName, from) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<(/?)${escaped}(\\s[^>]*)?(/?)>`, 'gi')
  re.lastIndex = from
  let depth = 1
  let match
  while ((match = re.exec(html)) !== null) {
    if (match[3] === '/') continue // self-closing, does not affect depth
    depth += match[1] === '/' ? -1 : 1
    if (depth === 0) {
      return { inner: html.slice(from, match.index), end: re.lastIndex }
    }
  }
  return null
}

const BLOCK_HANDLERS = [
  { tag: 'ac:structured-macro', handle: (inner, tag) => convertMacro(attr(tag, 'ac:name') || '', inner) },
  { tag: 'ac:link', handle: inner => convertAcLink(inner) },
  { tag: 'ac:image', handle: (inner, tag) => convertAcImage(inner, tag) },
  { tag: 'ac:task-list', handle: inner => convertTaskList(inner) },
  { tag: 'table', handle: inner => convertTable(inner) },
  { tag: 'ul', handle: (inner, tag, depth) => convertList(inner, false, depth) },
  { tag: 'ol', handle: (inner, tag, depth) => convertList(inner, true, depth) },
  { tag: 'blockquote', handle: inner => `\n\n${convert(inner).trim().split('\n').map(l => `> ${l}`.replace(/\s+$/, '')).join('\n')}\n\n` },
  { tag: 'pre', handle: inner => `\n\n\`\`\`\n${decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\s+$/, '')}\n\`\`\`\n\n` },
  { tag: 'strong', handle: inner => wrapInline(convert(inner), '**') },
  { tag: 'b', handle: inner => wrapInline(convert(inner), '**') },
  { tag: 'em', handle: inner => wrapInline(convert(inner), '*') },
  { tag: 'i', handle: inner => wrapInline(convert(inner), '*') },
  { tag: 'del', handle: inner => wrapInline(convert(inner), '~~') },
  { tag: 's', handle: inner => wrapInline(convert(inner), '~~') },
  { tag: 'code', handle: inner => wrapInline(plainText(inner), '`') },
  { tag: 'p', handle: inner => `\n\n${convert(inner).trim()}\n\n` },
  { tag: 'div', handle: inner => `\n\n${convert(inner).trim()}\n\n` },
  { tag: 'time', handle: (inner, tag) => attr(tag, 'datetime') || '' }
]

/**
 * Wrap inline content in a Markdown delimiter, keeping surrounding spaces outside.
 * @param {string} text - Inner text
 * @param {string} delimiter - Markdown delimiter
 * @returns {string} Wrapped text
 */
function wrapInline (text, delimiter) {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const lead = /^\s/.test(text) ? ' ' : ''
  const trail = /\s$/.test(text) ? ' ' : ''
  return `${lead}${delimiter}${trimmed}${delimiter}${trail}`
}

/**
 * Convert Confluence storage-format XHTML to Markdown.
 * @param {string} storage - Storage-format body
 * @param {number} [depth] - Internal nesting depth
 * @returns {string} Markdown
 */
function convert (storage, depth = 0) {
  if (!storage) return ''
  let html = String(storage)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:span|font|ac:layout|ac:layout-section|ac:layout-cell|ac:adf-extension|ac:adf-fallback)[^>]*>/gi, '')

  let out = ''
  let cursor = 0

  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor)
    if (lt === -1) {
      out += escapeMarkdown(decodeEntities(html.slice(cursor)))
      break
    }
    out += escapeMarkdown(decodeEntities(html.slice(cursor, lt)))

    const gt = html.indexOf('>', lt)
    if (gt === -1) break
    const tag = html.slice(lt, gt + 1)
    const nameMatch = tag.match(/^<\/?\s*([a-zA-Z][\w:-]*)/)
    const tagName = nameMatch ? nameMatch[1].toLowerCase() : ''
    const selfClosing = /\/>$/.test(tag) || ['br', 'hr', 'img', 'ri:page', 'ri:url', 'ri:attachment', 'ri:user'].includes(tagName)

    // Backslash hard break, not two spaces: the trailing-whitespace cleanup
    // at the end of convert() would strip a two-space break.
    if (tagName === 'br') { out += '\\\n'; cursor = gt + 1; continue }
    if (tagName === 'hr') { out += '\n\n---\n\n'; cursor = gt + 1; continue }
    if (tagName === 'img') {
      out += `![${attr(tag, 'alt') || ''}](${attr(tag, 'src') || ''})`
      cursor = gt + 1
      continue
    }

    const heading = tagName.match(/^h([1-6])$/)
    if (heading && !tag.startsWith('</')) {
      const element = matchElement(html, tagName, gt + 1)
      if (element) {
        out += `\n\n${'#'.repeat(Number(heading[1]))} ${convert(element.inner).trim()}\n\n`
        cursor = element.end
        continue
      }
    }

    if (tagName === 'a' && !tag.startsWith('</')) {
      const element = matchElement(html, 'a', gt + 1)
      if (element) {
        const href = attr(tag, 'href') || ''
        const label = convert(element.inner).trim() || href
        out += href ? `[${label}](${href})` : label
        cursor = element.end
        continue
      }
    }

    const handler = BLOCK_HANDLERS.find(h => h.tag === tagName)
    if (handler && !tag.startsWith('</') && !selfClosing) {
      const element = matchElement(html, tagName, gt + 1)
      if (element) {
        out += handler.handle(element.inner, tag, depth)
        cursor = element.end
        continue
      }
    }

    // Unhandled or stray tag: drop it and keep walking.
    cursor = gt + 1
  }

  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
}

module.exports = { convert, decodeEntities, plainText }
