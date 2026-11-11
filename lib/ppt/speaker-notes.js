/**
 * Speaker notes for editable PPTX output.
 *
 * Marp's --pptx-editable mode renders the deck to PDF and has LibreOffice
 * Impress import that PDF, so presenter notes are lost. These helpers read the
 * notes Marp exports with --notes and write them back into the finished PPTX.
 *
 * @module @defra/delivery-info-arch-tooling/ppt/speaker-notes
 */

const { readFileSync } = require('fs')
const { join } = require('path')
const JSZip = require('jszip')

const NOTES_SEPARATOR = '\n\n---\n\n'

const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL_NOTES_MASTER = `${NS_REL}/notesMaster`
const REL_NOTES_SLIDE = `${NS_REL}/notesSlide`
const REL_SLIDE = `${NS_REL}/slide`
const REL_THEME = `${NS_REL}/theme`
const CT_NOTES_MASTER = 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml'
const CT_NOTES_SLIDE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'
const CT_THEME = 'application/vnd.openxmlformats-officedocument.theme+xml'

const NOTES_MASTER_TEMPLATE = join(__dirname, '..', '..', 'templates', 'pptx-notes-master.xml')

/**
 * Split the text that `marp --notes` writes into one entry per slide.
 * Marp joins slides with a blank-line-separated `---`, and a slide without
 * notes gives an empty entry, so the result lines up with the slides.
 *
 * The `<!-- fit -->` comments that slide conversion inserts are not Marp
 * directives outside a heading, so Marp exports them as notes. They are
 * removed here.
 *
 * @param {string} text - Contents of the Marp notes file
 * @returns {string[]} Notes for each slide, in slide order
 */
function parseMarpNotes (text) {
  return text.replace(/\r\n/g, '\n').split(NOTES_SEPARATOR).map(note => note
    .split(/\n{2,}/)
    .filter(paragraph => paragraph.trim().toLowerCase() !== 'fit')
    .join('\n\n')
    .trim()
  )
}

function escapeXml (value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function notesParagraphs (note) {
  return note.split('\n').map(line => line.trim()
    ? `<a:p><a:r><a:rPr lang="en-GB" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
    : '<a:p><a:endParaRPr lang="en-GB" dirty="0"/></a:p>'
  ).join('')
}

function notesSlideXml (note) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${notesParagraphs(note)}</p:txBody></p:sp>` +
    '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'
}

function relsXml (relationships) {
  const items = relationships
    .map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
    .join('')
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`
}

function parseRels (xml) {
  const rels = []
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0]
    const attr = name => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1]
    rels.push({ id: attr('Id'), type: attr('Type'), target: attr('Target') })
  }
  return rels
}

function nextRelId (rels) {
  const max = rels.reduce((n, r) => Math.max(n, Number((r.id || '').replace(/^rId/, '')) || 0), 0)
  return `rId${max + 1}`
}

function addRelationship (xml, rel) {
  return xml.replace('</Relationships>', `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/></Relationships>`)
}

function addContentTypeOverride (xml, partName, contentType) {
  if (xml.includes(`PartName="${partName}"`)) return xml
  return xml.replace('</Types>', `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`)
}

/**
 * Slide part paths (e.g. `ppt/slides/slide3.xml`) in presentation order.
 */
function orderedSlidePaths (presentationXml, presentationRels) {
  const byId = new Map(presentationRels.map(r => [r.id, r]))
  const list = (presentationXml.match(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/) || [])[1] || ''
  return [...list.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map(m => byId.get(m[1]))
    .filter(r => r && r.type === REL_SLIDE)
    .map(r => join('ppt', r.target).replace(/\\/g, '/'))
}

/**
 * Write a part without adding folder entries to the zip. PowerPoint-written
 * packages contain only parts, and JSZip would otherwise add an entry for
 * each new folder.
 */
function putPart (zip, path, data) {
  zip.file(path, data, { createFolders: false })
}

/**
 * Ensure the package has a notes master, adding one from the template if not.
 * The new master gets its own copy of the presentation theme, as PowerPoint
 * writes it: PowerPoint asks to repair a deck whose notes master shares the
 * slide master's theme part.
 * @returns {Promise<string>} Part path of the notes master
 */
async function ensureNotesMaster (zip, state) {
  const existing = state.presentationRels.find(r => r.type === REL_NOTES_MASTER)
  if (existing) return join('ppt', existing.target).replace(/\\/g, '/')

  const theme = state.presentationRels.find(r => r.type === REL_THEME)
  const themeFile = theme && zip.file(join('ppt', theme.target).replace(/\\/g, '/'))
  if (!themeFile) throw new Error('PPTX has no theme to base a notes master on')

  let themeNumber = 1
  while (zip.file(`ppt/theme/theme${themeNumber}.xml`)) themeNumber++
  const notesThemePath = `ppt/theme/theme${themeNumber}.xml`
  putPart(zip, notesThemePath, await themeFile.async('nodebuffer'))
  state.contentTypesXml = addContentTypeOverride(state.contentTypesXml, `/${notesThemePath}`, CT_THEME)

  const masterPath = 'ppt/notesMasters/notesMaster1.xml'
  putPart(zip, masterPath, readFileSync(NOTES_MASTER_TEMPLATE, 'utf8'))
  putPart(zip, 'ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([
    { id: 'rId1', type: REL_THEME, target: `../theme/theme${themeNumber}.xml` }
  ]))

  const relId = nextRelId(state.presentationRels)
  const rel = { id: relId, type: REL_NOTES_MASTER, target: 'notesMasters/notesMaster1.xml' }
  state.presentationRels.push(rel)
  state.presentationRelsXml = addRelationship(state.presentationRelsXml, rel)

  // Schema order: sldMasterIdLst, notesMasterIdLst, handoutMasterIdLst, sldIdLst
  state.presentationXml = state.presentationXml.replace(
    '</p:sldMasterIdLst>',
    `</p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${relId}"/></p:notesMasterIdLst>`
  )
  state.contentTypesXml = addContentTypeOverride(state.contentTypesXml, `/${masterPath}`, CT_NOTES_MASTER)
  return masterPath
}

/**
 * Write speaker notes into a PPTX buffer.
 *
 * @param {Buffer} pptxBuffer - The PPTX file
 * @param {string[]} notes - Notes for each slide, in slide order
 * @returns {Promise<{buffer: Buffer|null, added: number, reason?: string}>}
 *   `buffer` is null when nothing was changed
 */
async function addSpeakerNotesToPptx (pptxBuffer, notes) {
  if (!notes.some(Boolean)) return { buffer: null, added: 0, reason: 'no notes' }

  const zip = await JSZip.loadAsync(pptxBuffer)
  const state = {
    presentationXml: await zip.file('ppt/presentation.xml').async('string'),
    presentationRelsXml: await zip.file('ppt/_rels/presentation.xml.rels').async('string'),
    contentTypesXml: await zip.file('[Content_Types].xml').async('string')
  }
  state.presentationRels = parseRels(state.presentationRelsXml)

  const slidePaths = orderedSlidePaths(state.presentationXml, state.presentationRels)
  if (slidePaths.length !== notes.length) {
    return {
      buffer: null,
      added: 0,
      reason: `deck has ${slidePaths.length} slides but Marp exported notes for ${notes.length}`
    }
  }

  const masterPath = await ensureNotesMaster(zip, state)
  let added = 0

  for (let i = 0; i < slidePaths.length; i++) {
    if (!notes[i]) continue

    const slidePath = slidePaths[i]
    const slideName = slidePath.split('/').pop()
    const slideRelsPath = slidePath.replace(/slides\/([^/]+)$/, 'slides/_rels/$1.rels')
    const slideRelsFile = zip.file(slideRelsPath)
    let slideRelsXml = slideRelsFile ? await slideRelsFile.async('string') : relsXml([])
    const slideRels = parseRels(slideRelsXml)
    if (slideRels.some(r => r.type === REL_NOTES_SLIDE)) continue

    const notesName = `notesSlide${i + 1}.xml`
    const notesPath = `ppt/notesSlides/${notesName}`
    putPart(zip, notesPath, notesSlideXml(notes[i]))
    putPart(zip, `ppt/notesSlides/_rels/${notesName}.rels`, relsXml([
      { id: 'rId1', type: REL_NOTES_MASTER, target: `../${masterPath.replace(/^ppt\//, '')}` },
      { id: 'rId2', type: REL_SLIDE, target: `../slides/${slideName}` }
    ]))

    slideRelsXml = addRelationship(slideRelsXml, {
      id: nextRelId(slideRels),
      type: REL_NOTES_SLIDE,
      target: `../notesSlides/${notesName}`
    })
    putPart(zip, slideRelsPath, slideRelsXml)
    state.contentTypesXml = addContentTypeOverride(state.contentTypesXml, `/${notesPath}`, CT_NOTES_SLIDE)
    added++
  }

  putPart(zip, 'ppt/presentation.xml', state.presentationXml)
  putPart(zip, 'ppt/_rels/presentation.xml.rels', state.presentationRelsXml)
  putPart(zip, '[Content_Types].xml', state.contentTypesXml)

  // Repack with parts only, dropping any folder entries the input carried
  const output = new JSZip()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) putPart(output, name, await entry.async('nodebuffer'))
  }
  const buffer = await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { buffer, added }
}

module.exports = {
  parseMarpNotes,
  addSpeakerNotesToPptx
}
