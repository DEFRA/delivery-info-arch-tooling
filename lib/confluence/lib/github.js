/**
 * GitHub integration functions
 * @module @defra/delivery-info-arch-tooling/confluence/github
 */

const path = require('path')
const { execSync } = require('child_process')

/**
 * Get GitHub source URL for a file
 * @param {string} filePath - Path to file
 * @returns {string|null} GitHub URL or null
 */
function getGitHubSourceUrl (filePath) {
  // Try to get from environment variables (GitHub Actions)
  let githubRepo = process.env.GITHUB_REPOSITORY || ''

  // If not in GitHub Actions, try to detect from git
  if (!githubRepo) {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim()
      if (remoteUrl) {
        // Convert git@github.com:user/repo.git to user/repo
        githubRepo = remoteUrl
          .replace(/.*github\.com[:/]([^/]+\/[^/]+)\.git/, '$1')
          .replace(/.*github\.com\/([^/]+\/[^/]+)/, '$1')
      }
    } catch (e) {
      // Git not available or not a git repo
    }
  }

  if (!githubRepo) {
    return null
  }

  // Get relative path from repo root
  let relPath = filePath
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
    if (filePath.startsWith(repoRoot)) {
      relPath = path.relative(repoRoot, filePath)
    }
  } catch (e) {
    // Not a git repo or git not available
  }

  // Construct GitHub URL (without branch - will use default branch)
  return `https://github.com/${githubRepo}/${relPath}`
}

module.exports = {
  getGitHubSourceUrl
}

