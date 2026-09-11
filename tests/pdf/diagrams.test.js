/**
 * Unit tests for pdf/diagrams.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { resolveDiagramTags, findDiagramImage } = require('../../lib/pdf/diagrams')

describe('pdf/diagrams', () => {
  let rootDir
  let inputPath
  let log

  const write = (relPath, content = '') => {
    const abs = path.join(rootDir, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
    return abs
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pdf-diagrams-'))
    inputPath = write('docs/system/Views/page.md', '')
    log = jest.fn()
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  describe('findDiagramImage', () => {
    it('prefers generated/diagrams over other locations', () => {
      const preferred = write('generated/diagrams/flow.png')
      write('build/mmd/arch/mmd/flow.png')

      expect(findDiagramImage('flow', rootDir)).toBe(preferred)
    })

    it('finds nested images under build/mmd', () => {
      const nested = write('build/mmd/architecture/current/btms/mmd/flow.svg')

      expect(findDiagramImage('flow', rootDir)).toBe(nested)
    })

    it('falls back to legacy likec4-exports and architecture/export', () => {
      const legacy = write('astro/likec4-exports/view.png')
      expect(findDiagramImage('view', rootDir)).toBe(legacy)

      fs.rmSync(legacy)
      const exported = write('architecture/export/view.png')
      expect(findDiagramImage('view', rootDir)).toBe(exported)
    })

    it('returns null when nothing matches', () => {
      expect(findDiagramImage('missing', rootDir)).toBeNull()
    })
  })

  describe('resolveDiagramTags', () => {
    it('replaces a MermaidDiagram tag with an image relative to the markdown file', () => {
      write('generated/diagrams/flow.png')

      const result = resolveDiagramTags('Before\n\n<MermaidDiagram diagramId="flow" width="900" />\n\nAfter', { inputPath, rootDir, log })

      expect(result).toBe('Before\n\n![flow](../../../generated/diagrams/flow.png)\n\nAfter')
      expect(log).not.toHaveBeenCalled()
    })

    it('does not add a diagram source link', () => {
      write('generated/diagrams/flow.png')
      write('architecture/current/btms/mmd/flow.mmd', 'sequenceDiagram')

      const result = resolveDiagramTags('<MermaidDiagram diagramId="flow" />', { inputPath, rootDir, log })

      expect(result).toBe('![flow](../../../generated/diagrams/flow.png)')
      expect(result).not.toContain('Diagram source')
    })

    it('handles the non-self-closing MermaidDiagram form', () => {
      write('generated/diagrams/flow.png')

      const result = resolveDiagramTags('<MermaidDiagram diagramId="flow">\nfallback\n</MermaidDiagram>', { inputPath, rootDir, log })

      expect(result).toBe('![flow](../../../generated/diagrams/flow.png)')
    })

    it('replaces a LikeC4View tag with an image', () => {
      write('generated/diagrams/current/btms/c4/btmsContext.png')

      const result = resolveDiagramTags('<LikeC4View viewId="btmsContext" />', { inputPath, rootDir, log })

      expect(result).toBe('![btmsContext](../../../generated/diagrams/current/btms/c4/btmsContext.png)')
    })

    it('leaves a visible placeholder and warns when the image is missing', () => {
      const result = resolveDiagramTags('<MermaidDiagram diagramId="nope" />', { inputPath, rootDir, log })

      expect(result).toBe("*Diagram 'nope' not found*")
      expect(log).toHaveBeenCalledWith(expect.stringContaining("image not found for 'nope'"))
    })

    it('leaves markdown without diagram tags untouched', () => {
      const markdown = '# Title\n\n![plain](./img.png)\n\n<!-- GITHUB_ONLY -->\ntext\n<!-- /GITHUB_ONLY -->'

      expect(resolveDiagramTags(markdown, { inputPath, rootDir, log })).toBe(markdown)
    })

    it('defaults rootDir to the current working directory', () => {
      const cwd = process.cwd()
      process.chdir(rootDir)
      try {
        write('generated/diagrams/flow.png')
        const result = resolveDiagramTags('<MermaidDiagram diagramId="flow" />', { inputPath, log })
        expect(result).toBe('![flow](../../../generated/diagrams/flow.png)')
      } finally {
        process.chdir(cwd)
      }
    })
  })
})
