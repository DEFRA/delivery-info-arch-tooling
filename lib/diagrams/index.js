/**
 * Diagram Processing Module
 * @module @defra/delivery-info-arch-tooling/diagrams
 *
 * Provides functions for processing diagrams (LikeC4, Mermaid).
 */

const { execSync } = require('child_process')
const fs = require('fs').promises
const path = require('path')

/**
 * Convert LikeC4 dynamic views to Mermaid sequence diagrams
 * @param {Object} options - Conversion options
 * @param {string} options.sourceDir - Source directory with .c4 files
 * @param {string} options.outputDir - Output directory for .mmd files
 * @returns {Promise<Object>} Results { generated: string[], errors: string[] }
 */
async function convertLikeC4ToMermaid (options) {
  const {
    sourceDir = 'architecture/current/btms',
    outputDir = 'architecture/current/btms/mmd'
  } = options

  const scriptPath = path.join(__dirname, 'convert-likec4-to-mermaid.js')

  try {
    execSync(`node "${scriptPath}" "${sourceDir}" "${outputDir}"`, { stdio: 'inherit' })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Render Mermaid diagrams to images
 * @param {Object} options - Rendering options
 * @param {string} options.inputDir - Directory with .mmd files (default: scans all directories)
 * @param {string} options.outputDir - Output directory (default: 'build/mmd')
 * @param {string} options.format - Output format: 'svg' or 'png' (default: 'svg')
 * @param {number} options.width - Image width for PNG (default: 1800)
 * @returns {Promise<Object>} Results { generated: string[], errors: string[] }
 */
async function renderMermaidDiagrams (options = {}) {
  const {
    outputDir = 'build/mmd',
    format = 'svg',
    width = 1800
  } = options

  const scriptPath = path.join(__dirname, 'convert-mmd.js')

  try {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit' })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * Export LikeC4 diagrams to images
 * @param {Object} options - Export options
 * @param {string} options.sourceDir - Source directory with .c4 files
 * @param {string} options.outputDir - Output directory for images
 * @param {string} options.format - Output format: 'png' or 'svg' (default: 'png')
 * @returns {Promise<Object>} Results
 */
async function exportLikeC4Diagrams (options = {}) {
  const {
    sourceDir = 'architecture',
    outputDir = 'generated/diagrams',
    format = 'png'
  } = options

  try {
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true })

    // Run likec4 export
    execSync(`npx likec4 export ${format} "${sourceDir}" -o "${outputDir}"`, { stdio: 'inherit' })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

module.exports = {
  convertLikeC4ToMermaid,
  renderMermaidDiagrams,
  exportLikeC4Diagrams
}

