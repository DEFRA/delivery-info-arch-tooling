/**
 * PDF Export Module
 * @module @defra/delivery-info-arch-tooling/pdf
 *
 * Provides functions for exporting markdown to PDF.
 */

const fs = require('fs')
const path = require('path')

/**
 * Export markdown to PDF
 * @param {Object} options - Export options
 * @param {string} options.inputFile - Input markdown file
 * @param {string} options.outputDir - Output directory (default: 'generated/pdf')
 * @param {string} options.cssPath - Custom CSS file path (optional)
 * @returns {Promise<string>} Path to generated PDF file
 */
async function exportToPdf (options) {
  const {
    inputFile,
    outputDir = 'generated/pdf',
    cssPath
  } = options

  if (!inputFile) {
    throw new Error('inputFile is required')
  }

  // Try to load markdown-pdf
  let markdownpdf
  try {
    markdownpdf = require('markdown-pdf')
  } catch (e) {
    throw new Error('markdown-pdf package is required. Install with: npm install markdown-pdf')
  }

  const inputPath = path.resolve(inputFile)

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputFile}`)
  }

  // Generate output path
  const relativePath = path.relative(process.cwd(), inputPath)
  const outputPath = path.join(outputDir, relativePath.replace(/\.md$/, '.pdf'))

  // Ensure output directory exists
  const outputDirPath = path.dirname(outputPath)
  if (!fs.existsSync(outputDirPath)) {
    fs.mkdirSync(outputDirPath, { recursive: true })
  }

  // Build options
  const pdfOptions = {
    remarkable: {
      html: true,
      breaks: true
    }
  }

  if (cssPath && fs.existsSync(cssPath)) {
    pdfOptions.cssPath = cssPath
  }

  // Convert
  return new Promise((resolve, reject) => {
    markdownpdf(pdfOptions)
      .from(inputPath)
      .to(outputPath, (err) => {
        if (err) reject(err)
        else resolve(outputPath)
      })
  })
}

/**
 * Export multiple markdown files to PDF
 * @param {Object} options - Export options
 * @param {string[]} options.inputFiles - Input markdown files
 * @param {string} options.outputDir - Output directory
 * @param {string} options.cssPath - Custom CSS file path (optional)
 * @returns {Promise<Object>} Results { success: string[], failed: string[] }
 */
async function exportMultiple (options) {
  const { inputFiles, outputDir = 'generated/pdf', cssPath } = options

  const results = {
    success: [],
    failed: []
  }

  for (const file of inputFiles) {
    try {
      const output = await exportToPdf({ inputFile: file, outputDir, cssPath })
      results.success.push(output)
    } catch (error) {
      results.failed.push({ file, error: error.message })
    }
  }

  return results
}

module.exports = {
  export: exportToPdf,
  exportMultiple
}

