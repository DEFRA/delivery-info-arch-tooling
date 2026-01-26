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

  // Try to load md-to-pdf
  let mdToPdf
  try {
    const mdToPdfModule = require('md-to-pdf')
    mdToPdf = mdToPdfModule.mdToPdf || mdToPdfModule.default || mdToPdfModule
  } catch (e) {
    throw new Error('md-to-pdf package is required. Install with: npm install md-to-pdf')
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

  // Build PDF options
  const pdfOptions = {
    pdf_options: {
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      }
    },
    stylesheet: cssPath && fs.existsSync(cssPath) ? [cssPath] : [],
    body_class: 'markdown-body',
    marked_options: {
      breaks: true,
      gfm: true
    }
  }

  // Convert markdown to PDF
  const pdf = await mdToPdf({ path: inputPath }, pdfOptions)

  if (!pdf) {
    throw new Error('PDF generation returned null')
  }

  // Write PDF to file
  fs.writeFileSync(outputPath, pdf.content)

  return outputPath
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

