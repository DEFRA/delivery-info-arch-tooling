/**
 * Locate the mermaid-cli (mmdc) executable.
 * @module @defra/delivery-info-arch-tooling/diagrams/mmdc
 */

const { existsSync } = require('fs')
const { join } = require('path')

// Ubuntu 23.10+ (including GitHub-hosted 24.04 and 26.04) blocks the user
// namespaces Chromium's sandbox needs. Mermaid only renders local .mmd files.
const puppeteerConfigPath = join(__dirname, 'puppeteer-no-sandbox.json')

function mmdcPuppeteerArgs () {
  if (process.platform !== 'linux') {
    return ''
  }
  return ` -p "${puppeteerConfigPath}"`
}

function findMmdc (rootDir = process.cwd()) {
  const libMmdc = join(__dirname, '..', '..', 'node_modules', '.bin', 'mmdc')
  if (existsSync(libMmdc)) {
    return libMmdc
  }

  const consumerMmdc = join(rootDir, 'node_modules', '.bin', 'mmdc')
  if (existsSync(consumerMmdc)) {
    return consumerMmdc
  }

  return 'npx mmdc'
}

module.exports = {
  findMmdc,
  mmdcPuppeteerArgs
}
