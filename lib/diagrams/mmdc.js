/**
 * Locate the mermaid-cli (mmdc) executable.
 * @module @defra/delivery-info-arch-tooling/diagrams/mmdc
 */

const { existsSync } = require('fs')
const { join } = require('path')

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
  findMmdc
}
