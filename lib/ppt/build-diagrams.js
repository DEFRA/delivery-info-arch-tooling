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

function exportLikeC4Views (viewIds, options) {
  if (viewIds.length === 0) {
    return
  }

  mkdirSync(options.outputDir, { recursive: true })

  let cmd = `npx likec4 export ${options.format} "${options.sourceDir}" -o "${options.outputDir}"`
  for (const viewId of viewIds) {
    cmd += ` -f "${viewId}"`
  }

  console.log(`Exporting ${viewIds.length} LikeC4 view(s): ${viewIds.join(', ')}`)
  execSync(cmd, { stdio: 'inherit' })
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

  if (likeC4Views.length > 0) {
    exportLikeC4Views(likeC4Views, { sourceDir, outputDir, format })
  }

  if (mermaidDiagrams.length > 0) {
    renderMermaidDiagrams(mermaidDiagrams, { rootDir, outputDir })
  }

  console.log('\n✅ PPT diagram build complete')
  return { ...refs, built: true }
}

module.exports = {
  buildPptDiagrams,
  findMmdFile
}
