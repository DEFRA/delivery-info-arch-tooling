const JSZip = require('jszip')
const { parseMarpNotes, addSpeakerNotesToPptx } = require('../../lib/ppt/speaker-notes')

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * A minimal deck shaped like LibreOffice's editable output: slides, a theme
 * and no notes master.
 */
async function buildDeck (slideCount) {
  const zip = new JSZip()
  const slideRels = []
  const sldIds = []
  const overrides = []

  for (let i = 1; i <= slideCount; i++) {
    const id = `rId${i + 2}`
    slideRels.push(`<Relationship Id="${id}" Type="${REL}/slide" Target="slides/slide${i}.xml"/>`)
    sldIds.push(`<p:sldId id="${255 + i}" r:id="${id}"/>`)
    overrides.push(`<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    zip.file(`ppt/slides/slide${i}.xml`, '<p:sld/>')
    zip.file(`ppt/slides/_rels/slide${i}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>\n</Relationships>`)
  }

  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${overrides.join('')}</Types>`)
  zip.file('ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels.join('')}</Relationships>`)
  zip.file('ppt/presentation.xml',
    `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst>${sldIds.join('')}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/theme/theme1.xml', '<a:theme/>')

  return zip.generateAsync({ type: 'nodebuffer' })
}

describe('parseMarpNotes', () => {
  it('returns one entry per slide, empty where a slide has no notes', () => {
    const text = 'note for one\nsecond line\n\n---\n\n\n\n---\n\nnote three\n\nanother note three'

    expect(parseMarpNotes(text)).toEqual([
      'note for one\nsecond line',
      '',
      'note three\n\nanother note three'
    ])
  })

  it('drops the fit markers that slide conversion inserts', () => {
    const text = 'fit\n\n---\n\nfit\n\nreal note\n\n---\n\nreal note\n\nfit'

    expect(parseMarpNotes(text)).toEqual(['', 'real note', 'real note'])
  })
})

describe('addSpeakerNotesToPptx', () => {
  it('adds a notes master and a notes slide for each slide with notes', async () => {
    const deck = await buildDeck(3)

    const result = await addSpeakerNotesToPptx(deck, ['First & <one>', '', 'Third\n\nmore'])

    expect(result.added).toBe(2)
    const zip = await JSZip.loadAsync(result.buffer)

    const presentation = await zip.file('ppt/presentation.xml').async('string')
    expect(presentation).toMatch(/<\/p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId6"\/><\/p:notesMasterIdLst><p:sldIdLst>/)
    const presRels = await zip.file('ppt/_rels/presentation.xml.rels').async('string')
    expect(presRels).toContain(`Id="rId6" Type="${REL}/notesMaster" Target="notesMasters/notesMaster1.xml"`)
    expect(zip.file('ppt/notesMasters/notesMaster1.xml')).not.toBeNull()
    const masterRels = await zip.file('ppt/notesMasters/_rels/notesMaster1.xml.rels').async('string')
    expect(masterRels).toContain('Target="../theme/theme2.xml"')
    expect(await zip.file('ppt/theme/theme2.xml').async('string')).toBe('<a:theme/>')
    expect(Object.values(zip.files).filter(f => f.dir)).toEqual([])

    const notes1 = await zip.file('ppt/notesSlides/notesSlide1.xml').async('string')
    expect(notes1).toContain('<a:t>First &amp; &lt;one&gt;</a:t>')
    const notes3 = await zip.file('ppt/notesSlides/notesSlide3.xml').async('string')
    expect(notes3.match(/<a:p>/g)).toHaveLength(3)
    expect(zip.file('ppt/notesSlides/notesSlide2.xml')).toBeNull()

    const slide1Rels = await zip.file('ppt/slides/_rels/slide1.xml.rels').async('string')
    expect(slide1Rels).toContain(`Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"`)
    const notesRels = await zip.file('ppt/notesSlides/_rels/notesSlide1.xml.rels').async('string')
    expect(notesRels).toContain('Target="../notesMasters/notesMaster1.xml"')
    expect(notesRels).toContain('Target="../slides/slide1.xml"')

    const types = await zip.file('[Content_Types].xml').async('string')
    expect(types).toContain('PartName="/ppt/notesMasters/notesMaster1.xml"')
    expect(types).toContain('PartName="/ppt/theme/theme2.xml"')
    expect(types).toContain('PartName="/ppt/notesSlides/notesSlide1.xml"')
    expect(types).toContain('PartName="/ppt/notesSlides/notesSlide3.xml"')
    expect(types).not.toContain('PartName="/ppt/notesSlides/notesSlide2.xml"')
  })

  it('leaves the deck alone when there are no notes', async () => {
    const result = await addSpeakerNotesToPptx(await buildDeck(2), ['', ''])

    expect(result).toEqual({ buffer: null, added: 0, reason: 'no notes' })
  })

  it('leaves the deck alone when the slide count does not match', async () => {
    const result = await addSpeakerNotesToPptx(await buildDeck(2), ['a', 'b', 'c'])

    expect(result.buffer).toBeNull()
    expect(result.reason).toBe('deck has 2 slides but Marp exported notes for 3')
  })
})
