/**
 * Unit tests for confluence/lib/link-verifier.js
 */

const { createLinkVerifier, collectLinks, headingAnchorsOfAdf } = require('../../lib/confluence/lib/link-verifier')

const base = 'https://test.atlassian.net'
const source = 'https://github.com/org/docs/blob/main/docs/page.md'

function heading (text) {
  return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] }
}

function link (href, text = 'link') {
  return { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] }
}

function doc (...content) {
  return { type: 'doc', version: 1, content }
}

describe('link-verifier', () => {
  describe('collectLinks', () => {
    it('lists link marks and smart-link cards once each', () => {
      const adf = doc(link('#a'), link('#a'), { type: 'paragraph', content: [{ type: 'inlineCard', attrs: { url: 'https://example.com' } }] })
      expect(collectLinks(adf)).toEqual(['#a', 'https://example.com'])
    })
  })

  describe('headingAnchorsOfAdf', () => {
    it('gives each heading its text with each space a hyphen', () => {
      const adf = doc(heading("IDM's Answer"), { type: 'heading', content: [{ type: 'text', text: 'End ' }, { type: 'text', text: 'State', marks: [{ type: 'code' }] }] })
      expect([...headingAnchorsOfAdf(adf)]).toEqual(["IDM's-Answer", 'End-State'])
    })
  })

  describe('verify', () => {
    const pages = {
      1: { title: 'Page One', adf: null },
      2: { title: 'Page Two', adf: doc(heading('Record Fields')) }
    }

    function makeVerifier (pageOne, reachable = () => ({ ok: true, status: 200 })) {
      pages[1].adf = pageOne
      const fetchPage = jest.fn(async (id) => pages[id] || null)
      const checkExternal = jest.fn(async (url) => reachable(url))
      return { verifier: createLinkVerifier({ confluenceUrl: base, fetchPage, checkExternal }), fetchPage, checkExternal }
    }

    it('passes anchors and page links that resolve, and skips the page\'s own source link', async () => {
      const { verifier } = makeVerifier(doc(
        heading('End State'),
        link('#End-State'),
        link(`${base}/wiki/spaces/EUDP/pages/2#Record-Fields`),
        link(`${base}/wiki/spaces/EUDP/pages/2/Page+Two`),
        link(source)
      ))

      const result = await verifier.verify([{ id: '1', sourceUrl: source }])

      expect(result).toEqual({ pages: 1, links: 4, broken: [], unreachable: [] })
    })

    it('reports a missing anchor, a missing page and a missing anchor on the target page', async () => {
      const { verifier } = makeVerifier(doc(
        link('#end-state'),
        link(`${base}/wiki/spaces/EUDP/pages/99`),
        link(`${base}/wiki/spaces/EUDP/pages/2#record-fields`)
      ))

      const result = await verifier.verify([{ id: '1', sourceUrl: source }])

      expect(result.broken).toEqual([
        { page: 'Page One', href: '#end-state', reason: 'no heading on this page has that anchor' },
        { page: 'Page One', href: `${base}/wiki/spaces/EUDP/pages/99`, reason: 'no Confluence page has ID 99' },
        { page: 'Page One', href: `${base}/wiki/spaces/EUDP/pages/2#record-fields`, reason: "no heading on 'Page Two' has that anchor" }
      ])
    })

    it('reports a link to another markdown source in the same repository as broken', async () => {
      const { verifier, checkExternal } = makeVerifier(doc(
        link('https://github.com/org/docs/blob/main/docs/other.md#part'),
        link('https://github.com/org/other-repo/blob/main/README.md')
      ))

      const result = await verifier.verify([{ id: '1', sourceUrl: source }])

      expect(result.broken).toEqual([{
        page: 'Page One',
        href: 'https://github.com/org/docs/blob/main/docs/other.md#part',
        reason: 'links to a markdown source on GitHub instead of its Confluence page'
      }])
      expect(checkExternal).toHaveBeenCalledWith('https://github.com/org/other-repo/blob/main/README.md')
    })

    it('reports an external link that does not answer as unreachable, not broken, and checks it once', async () => {
      const { verifier, checkExternal } = makeVerifier(doc(link('https://down.example.com/x')), () => ({ ok: false, status: 404 }))

      const result = await verifier.verify([{ id: '1', sourceUrl: source }, { id: '1', sourceUrl: source }])

      expect(result.broken).toEqual([])
      expect(result.unreachable).toHaveLength(2)
      expect(result.unreachable[0]).toEqual({ page: 'Page One', href: 'https://down.example.com/x', reason: '404' })
      expect(checkExternal).toHaveBeenCalledTimes(1)
    })

    it('reports a published page it cannot read', async () => {
      const { verifier } = makeVerifier(doc())

      const result = await verifier.verify([{ id: '42', sourceUrl: source }])

      expect(result.broken).toEqual([{ page: '42', href: '(page)', reason: 'the published page was not found' }])
    })
  })
})
