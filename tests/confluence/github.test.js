/**
 * Unit tests for confluence/lib/github.js
 */

const { execSync } = require('child_process')
const path = require('path')
const { getGitHubSourceUrl } = require('../../lib/confluence/lib/github')

// Mock child_process
jest.mock('child_process', () => ({
  execSync: jest.fn()
}))

describe('github', () => {
  const originalEnv = process.env
  const originalCwd = process.cwd

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.GITHUB_REPOSITORY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getGitHubSourceUrl', () => {
    it('should return null if no GitHub repo detected', () => {
      execSync.mockImplementation(() => '')
      const result = getGitHubSourceUrl('/some/path/file.md')
      expect(result).toBeNull()
    })

    it('should use GITHUB_REPOSITORY environment variable', () => {
      process.env.GITHUB_REPOSITORY = 'defra/test-repo'
      execSync.mockImplementation((command) => {
        if (command.includes('rev-parse --show-toplevel')) {
          return '/repo/root'
        }
        return ''
      })

      const result = getGitHubSourceUrl('/repo/root/docs/file.md')
      expect(result).toBe('https://github.com/defra/test-repo/docs/file.md')
    })

    it('should extract repo from git remote URL (SSH format)', () => {
      execSync.mockImplementation((command) => {
        if (command.includes('remote.origin.url')) {
          return 'git@github.com:defra/test-repo.git'
        }
        if (command.includes('rev-parse --show-toplevel')) {
          return '/repo/root'
        }
        return ''
      })

      const result = getGitHubSourceUrl('/repo/root/docs/file.md')
      expect(result).toBe('https://github.com/defra/test-repo/docs/file.md')
    })

    it('should extract repo from git remote URL (HTTPS format)', () => {
      execSync.mockImplementation((command) => {
        if (command.includes('remote.origin.url')) {
          return 'https://github.com/defra/test-repo.git'
        }
        if (command.includes('rev-parse --show-toplevel')) {
          return '/repo/root'
        }
        return ''
      })

      const result = getGitHubSourceUrl('/repo/root/docs/file.md')
      expect(result).toBe('https://github.com/defra/test-repo/docs/file.md')
    })

    it('should handle relative paths correctly', () => {
      process.env.GITHUB_REPOSITORY = 'defra/test-repo'
      execSync.mockImplementation((command) => {
        if (command.includes('rev-parse --show-toplevel')) {
          return '/repo/root'
        }
        return ''
      })

      const result = getGitHubSourceUrl('/repo/root/docs/subdir/file.md')
      expect(result).toBe('https://github.com/defra/test-repo/docs/subdir/file.md')
    })

    it('should handle absolute paths outside repo root', () => {
      process.env.GITHUB_REPOSITORY = 'defra/test-repo'
      execSync.mockImplementation((command) => {
        if (command.includes('rev-parse --show-toplevel')) {
          return '/repo/root'
        }
        return ''
      })

      const result = getGitHubSourceUrl('/outside/path/file.md')
      // Path.relative will create a relative path that goes up and out
      expect(result).toContain('github.com/defra/test-repo')
    })

    it('should return null if git commands fail', () => {
      // Clear environment and make all git commands fail
      const savedRepo = process.env.GITHUB_REPOSITORY
      delete process.env.GITHUB_REPOSITORY
      
      execSync.mockImplementation((command) => {
        // All git commands fail
        throw new Error('Not a git repository')
      })

      const result = getGitHubSourceUrl('/some/path/file.md')
      expect(result).toBeNull()
      
      // Restore if needed
      if (savedRepo) process.env.GITHUB_REPOSITORY = savedRepo
    })

    it('should handle missing GITHUB_REPOSITORY and failed git remote', () => {
      execSync.mockImplementation((command) => {
        if (command.includes('remote.origin.url')) {
          throw new Error('Git not available')
        }
        return ''
      })

      const result = getGitHubSourceUrl('/some/path/file.md')
      expect(result).toBeNull()
    })
  })
})
