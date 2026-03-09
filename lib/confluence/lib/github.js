/**
 * GitHub integration functions
 * @module @defra/delivery-info-arch-tooling/confluence/github
 */

const path = require('path')
const { execSync } = require('child_process')

/**
 * Get GitHub source URL for a file or directory
 * @param {string} filePath - Path to file or directory
 * @param {boolean} [isDirectory=false] - If true, use tree/main/ (directory view); otherwise blob/main/ (file view)
 * @returns {string|null} GitHub URL or null
 */
function getGitHubSourceUrl (filePath, isDirectory = false) {
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

  // Branch (e.g. main); GITHUB_REF_NAME is set in GitHub Actions
  const branch = process.env.GITHUB_REF_NAME || process.env.GITHUB_BRANCH || 'main'
  // Encode path segments (spaces → %20) so URL is valid
  const encodedPath = relPath.split('/').map(seg => encodeURIComponent(seg)).join('/')
  // Directory pages use tree/main/; file pages use blob/main/
  const pathType = isDirectory ? 'tree' : 'blob'
  return `https://github.com/${githubRepo}/${pathType}/${branch}/${encodedPath}`
}

module.exports = {
  getGitHubSourceUrl
}

