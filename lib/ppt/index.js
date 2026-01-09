/**
 * PowerPoint Generation Module
 * @module @defra/delivery-info-arch-tooling/ppt
 *
 * Provides functions for converting markdown to PowerPoint presentations.
 */

const { execSync, existsSync } = require('child_process')
const path = require('path')

/**
 * Check if Marp CLI is available
 * @returns {string|boolean} 'npx' if available via npx, true if globally installed, false otherwise
 */
function checkMarp () {
  try {
    execSync('marp --version', { stdio: 'pipe' })
    return true
  } catch (error) {
    try {
      execSync('npx @marp-team/marp-cli --version', { stdio: 'pipe' })
      return 'npx'
    } catch (e) {
      return false
    }
  }
}

/**
 * Generate PowerPoint from markdown
 * @param {Object} options - Generation options
 * @param {string} options.inputFile - Input markdown file
 * @param {string} options.outputDir - Output directory (optional)
 * @param {string} options.outputFile - Output file path (optional)
 * @param {string} options.title - Presentation title (optional)
 * @param {string} options.author - Author name (optional)
 * @param {string} options.theme - Marp theme (default: 'defra')
 * @param {number} options.headingLevel - Heading level for slide breaks (1-6, default: 1)
 * @param {boolean} options.keepMarp - Keep intermediate .marp.md file
 * @returns {Promise<string>} Path to generated PPTX file
 */
async function generate (options) {
  const {
    inputFile,
    outputDir,
    outputFile,
    title,
    author,
    theme = 'defra',
    headingLevel = 1,
    keepMarp = false
  } = options

  if (!inputFile) {
    throw new Error('inputFile is required')
  }

  // Check Marp availability
  const marpAvailable = checkMarp()
  if (!marpAvailable) {
    throw new Error('Marp CLI is not installed. Install with: npm install -g @marp-team/marp-cli')
  }

  // Build command
  const scriptPath = path.join(__dirname, 'generate.js')

  const args = [inputFile]
  if (outputFile) args.push('--output', outputFile)
  if (title) args.push('--title', title)
  if (author) args.push('--author', author)
  if (theme) args.push('--theme', theme)
  if (headingLevel) args.push('--heading-level', String(headingLevel))
  if (keepMarp) args.push('--keep-marp')

  try {
    execSync(`node "${scriptPath}" ${args.join(' ')}`, { stdio: 'inherit' })

    // Determine output path
    const inputName = path.basename(inputFile, path.extname(inputFile))
    const finalOutput = outputFile || path.join(outputDir || 'generated/pptx', `${inputName}.pptx`)
    return finalOutput
  } catch (error) {
    throw new Error(`Failed to generate PPTX: ${error.message}`)
  }
}

module.exports = {
  generate,
  checkMarp
}

