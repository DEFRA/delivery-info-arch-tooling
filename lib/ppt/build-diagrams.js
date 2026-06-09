/**
 * Build only the diagram images referenced by a markdown file for PPT output.
 * @module @defra/delivery-info-arch-tooling/ppt/build-diagrams
 */

const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const { join, basename, relative, resolve } = require('path')
const { globSync } = require('glob')
const { extractDiagramRefsFromFile } = require('./diagram-refs')
const { findMmdc } = require('../diagrams/mmdc')

function findMmdFile (diagramId, rootDir) {
  const matches = globSync(`**/mmd/${diagramId}.mmd`, {
    cwd: rootDir,
    ignore: ['**/node_modules/**', '**/build/**', '**/generated/**']
  })

  return matches.length > 0 ? join(rootDir, matches[0]) : null
}

function likeC4PngExists (viewId, outputDir) {
  const flat = join(outputDir, `${viewId}.png`)
  if (existsSync(flat)) {
    return true
  }

  const matches = globSync(`**/${viewId}.png`, {
    cwd: outputDir,
    ignore: ['**/node_modules/**']
  })

  return matches.length > 0
}

function exportLikeC4Views (viewIds, options) {
  if (viewIds.length === 0) {
    return { exported: [], skipped: [], failed: [] }
  }

  mkdirSync(options.outputDir, { recursive: true })

  const toExport = []
  const skipped = []

  for (const viewId of viewIds) {
    if (likeC4PngExists(viewId, options.outputDir)) {
      skipped.push(viewId)
      console.log(`Skipping LikeC4 export (PNG exists): ${viewId}.png`)
    } else {
      toExport.push(viewId)
    }
  }

  if (toExport.length === 0) {
    return { exported: [], skipped, failed: [] }
  }

  let cmd = `npx likec4 export ${options.format} "${options.sourceDir}" -o "${options.outputDir}"`
  for (const viewId of toExport) {
    cmd += ` -f "${viewId}"`
  }

  console.log(`Exporting ${toExport.length} LikeC4 view(s): ${toExport.join(', ')}`)

  try {
    execSync(cmd, { stdio: 'inherit' })
    return { exported: toExport, skipped, failed: [] }
  } catch (error) {
    const message = error.stderr?.toString() || error.message || ''
    const playwrightMissing = /playwright install|Executable doesn't exist/i.test(message)

    console.error('\n✗ LikeC4 PNG export failed.')
    if (playwrightMissing) {
      console.error('  Playwright browsers are required for LikeC4 export. Run:')
      console.error('    npx playwright install chromium')
    } else {
      console.error(`  ${message.trim() || 'See output above.'}`)
    }

    return { exported: [], skipped, failed: toExport }
  }
}

function renderMermaidDiagrams (diagramIds, options) {
  if (diagramIds.length === 0) {
    return
  }

  const mmdcPath = findMmdc(options.rootDir)
  mkdirSync(options.outputDir, { recursive: true })

  for (const diagramId of diagramIds) {
    const mmdFile = findMmdFile(diagramId, options.rootDir)
    if (!mmdFile) {
      console.warn(`⚠️  Mermaid source not found: ${diagramId}.mmd`)
      continue
    }

    const pngFile = join(options.outputDir, `${diagramId}.png`)
    console.log(`Rendering ${relative(options.rootDir, mmdFile)} -> ${relative(options.rootDir, pngFile)}`)

    execSync(
      `"${mmdcPath}" -i "${mmdFile}" -o "${pngFile}" -b white -s 3`,
      { stdio: 'inherit', shell: true }
    )
  }
}

/**
 * Build diagram images referenced by a markdown file for PPT output.
 * @param {Object} options
 * @param {string} options.inputFile - Markdown file used for PPT generation
 * @param {string} [options.sourceDir='architecture'] - LikeC4 source directory
 * @param {string} [options.outputDir='generated/diagrams'] - PNG output directory
 * @param {string} [options.format='png'] - LikeC4 export format
 * @returns {{ likeC4Views: string[], mermaidDiagrams: string[], built: boolean }}
 */
function buildPptDiagrams (options) {
  const {
    inputFile,
    sourceDir = 'architecture',
    outputDir = 'generated/diagrams',
    format = 'png'
  } = options

  if (!inputFile) {
    throw new Error('inputFile is required')
  }

  const inputPath = resolve(inputFile)
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  const rootDir = process.cwd()
  const refs = extractDiagramRefsFromFile(inputPath, { format: 'ppt' })
  const { likeC4Views, mermaidDiagrams } = refs

  console.log(`Diagram references in PPT content for ${basename(inputPath)}:`)
  console.log(`  LikeC4 views: ${likeC4Views.length ? likeC4Views.join(', ') : '(none)'}`)
  console.log(`  Mermaid diagrams: ${mermaidDiagrams.length ? mermaidDiagrams.join(', ') : '(none)'}`)
  console.log('')

  if (likeC4Views.length === 0 && mermaidDiagrams.length === 0) {
    console.log('No diagrams to build.')
    return { ...refs, built: false }
  }

  // Mermaid first — does not depend on Playwright; LikeC4 export can fail without blocking these.
  if (mermaidDiagrams.length > 0) {
    renderMermaidDiagrams(mermaidDiagrams, { rootDir, outputDir })
  }

  let likeC4Result = { exported: [], skipped: [], failed: [] }
  if (likeC4Views.length > 0) {
    likeC4Result = exportLikeC4Views(likeC4Views, { sourceDir, outputDir, format })
  }

  if (likeC4Result.failed.length > 0) {
    const missing = likeC4Views.filter((id) => !likeC4PngExists(id, outputDir))
    if (missing.length > 0) {
      throw new Error(
        `LikeC4 export failed for: ${missing.join(', ')}. ` +
        'Run `npx playwright install chromium` from the documentation repo, then retry.'
      )
    }
    console.warn(`⚠️  LikeC4 export failed but existing PNGs were found for: ${likeC4Result.failed.join(', ')}`)
  }

  console.log('\n✅ PPT diagram build complete')
  return { ...refs, built: true, likeC4Result }
}

module.exports = {
  buildPptDiagrams,
  findMmdFile
}
