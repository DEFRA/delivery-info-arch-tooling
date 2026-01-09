/**
 * Defra Documentation Tooling Library
 * @module @defra/delivery-info-arch-tooling
 *
 * Shared tooling for generating documentation (Confluence, PPT, PDF) across Defra verticals.
 *
 * @example
 * const tooling = require('@defra/delivery-info-arch-tooling');
 *
 * // Publish to Confluence
 * await tooling.confluence.publish({
 *   configPath: 'confluence-config.json',
 *   auth: { username: '...', apiToken: '...' }
 * });
 *
 * // Generate PPT
 * await tooling.ppt.generate({
 *   inputFile: 'docs/overview.md',
 *   title: 'System Overview'
 * });
 *
 * // Export PDF
 * await tooling.pdf.export({
 *   inputFile: 'docs/analysis.md'
 * });
 */

const confluence = require('./confluence')
const ppt = require('./ppt')
const pdf = require('./pdf')
const diagrams = require('./diagrams')

module.exports = {
    confluence,
    ppt,
    pdf,
    diagrams,

    // Re-export for convenience
    publish: confluence.publish,
    validateConfig: confluence.validateConfig
}

