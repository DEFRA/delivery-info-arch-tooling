/**
 * Confluence Publishing Module
 * @module @defra/delivery-info-arch-tooling/confluence
 *
 * Provides functions for publishing markdown documentation to Confluence.
 */

const fs = require('fs').promises
const path = require('path')

// Import internal modules
const utils = require('./lib/utils')
const apiClient = require('./lib/api-client')
const pageManager = require('./lib/page-manager')
const contentProcessor = require('./lib/content-processor')
const github = require('./lib/github')
const imageHandler = require('./lib/image-handler')
const hierarchyManager = require('./lib/hierarchy-manager')

/**
 * Validate configuration file
 * @param {string} configPath - Path to confluence-config.json
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateConfig (configPath) {
  const errors = []

  try {
    const fs = require('fs')
    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)

    // Check required fields
    if (!config.spaceMapping || typeof config.spaceMapping !== 'object') {
      errors.push('Missing or invalid spaceMapping object')
    }

    if (!config.publishPaths || !Array.isArray(config.publishPaths)) {
      errors.push('Missing or invalid publishPaths array')
    } else {
      config.publishPaths.forEach((item, index) => {
        if (!item.path) {
          errors.push(`publishPaths[${index}]: missing 'path' property`)
        }
      })
    }

    return {
      valid: errors.length === 0,
      errors
    }
  } catch (error) {
    return {
      valid: false,
      errors: [`Failed to read/parse config: ${error.message}`]
    }
  }
}

/**
 * Create configuration template
 * @param {string} outputPath - Path to write template
 */
async function createConfigTemplate (outputPath) {
  const template = {
    spaceMapping: {
      SYSTEM_NAME: 'SPACE_KEY',
      Trade: 'TIDIA',
      BTMS: 'BTMS'
    },
    publishPaths: [
      {
        path: 'systems/BTMS/**/*.md',
        type: 'markdown',
        description: 'BTMS documentation'
      }
    ],
    parentPageId: '',
    excludePatterns: [
      'README.md',
      '_*.md'
    ]
  }

  await fs.writeFile(outputPath, JSON.stringify(template, null, 2), 'utf-8')
}

/**
 * Publish documentation to Confluence
 * @param {Object} options - Publishing options
 * @param {string} options.configPath - Path to confluence-config.json
 * @param {string} options.spaceFilter - Optional space filter
 * @param {string} options.parentPageId - Optional parent page ID
 * @param {Object} options.auth - Authentication { username, apiToken }
 * @param {string} options.contentRoot - Root directory for content
 * @param {string} options.confluenceUrl - Confluence URL (optional)
 * @returns {Promise<Object>} Publishing results { success: number, failed: number, skipped: number }
 */
async function publish (options) {
  const {
    configPath,
    spaceFilter = null,
    parentPageId = null,
    auth,
    contentRoot = 'docs',
    confluenceUrl = process.env.CONFLUENCE_URL || 'https://eaflood.atlassian.net'
  } = options

  // Validate auth
  if (!auth || !auth.username || !auth.apiToken) {
    throw new Error('Authentication required: provide auth.username and auth.apiToken')
  }

  // Load config
  let config = {}
  if (configPath) {
    const validation = validateConfig(configPath)
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join(', ')}`)
    }
    const content = await fs.readFile(configPath, 'utf-8')
    config = JSON.parse(content)
  }

  // Configure modules
  const moduleConfig = {
    confluenceUrl,
    defaultSpace: process.env.CONFLUENCE_SPACE || '',
    contentRoot,
    generatedLabel: process.env.GENERATED_LABEL || 'generated',
    configPath // Pass configPath to hierarchy manager for space mapping
  }

  apiClient.setConfig(moduleConfig)
  pageManager.setConfig(moduleConfig)
  imageHandler.setConfig(moduleConfig)
  hierarchyManager.setConfig(moduleConfig)

  // Statistics
  const stats = {
    success: 0,
    failed: 0,
    skipped: 0
  }

  // Process publishPaths from config
  if (config.publishPaths && Array.isArray(config.publishPaths)) {
    const { glob } = require('glob')

    for (const pathConfig of config.publishPaths) {
      const filePath = pathConfig.path
      const pathType = pathConfig.type || 'markdown'
      const exclude = pathConfig.exclude || []

      if (!filePath) continue

      let fullPath = filePath
      if (!path.isAbsolute(filePath)) {
        fullPath = path.join(contentRoot, filePath)
      }

      // Handle glob patterns
      if (filePath.includes('*')) {
        const files = await glob(fullPath)
        for (const file of files) {
          const stat = await fs.stat(file)
          if (stat.isFile()) {
            // Check exclusions
            if (shouldExcludeFile(file, exclude, contentRoot)) {
              stats.skipped++
              continue
            }

            try {
              const fileConfig = { ...moduleConfig, configPath }
              if (pathType === 'diagram') {
                await publishDiagramFile(file, spaceFilter, parentPageId, auth, fileConfig)
              } else {
                await publishMarkdownFile(file, spaceFilter, parentPageId, auth, fileConfig)
              }
              stats.success++
            } catch (error) {
              console.error(`  ❌ Failed to publish ${file}: ${error.message}`)
              stats.failed++
            }
          }
        }
      } else {
        // Single file
        try {
          await fs.access(fullPath)
          const fileConfig = { ...moduleConfig, configPath }
          if (pathType === 'diagram') {
            await publishDiagramFile(fullPath, spaceFilter, parentPageId, auth, fileConfig)
          } else {
            await publishMarkdownFile(fullPath, spaceFilter, parentPageId, auth, fileConfig)
          }
          stats.success++
        } catch (error) {
          if (error.code === 'ENOENT') {
            console.error(`  ⚠️  File not found: ${fullPath}`)
          } else {
            console.error(`  ❌ Failed to publish ${fullPath}: ${error.message}`)
          }
          stats.failed++
        }
      }
    }
  }

  return stats
}

/**
 * Check if file should be excluded
 */
function shouldExcludeFile (filePath, excludePatterns, contentRoot) {
  if (!excludePatterns || !Array.isArray(excludePatterns) || excludePatterns.length === 0) {
    return false
  }

  const fileName = path.basename(filePath)
  const relativePath = path.relative(contentRoot || '', filePath)

  for (const pattern of excludePatterns) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    if (regex.test(fileName) || regex.test(relativePath)) {
      return true
    }
  }

  return false
}

/**
 * Publish a single markdown file
 */
async function publishMarkdownFile (filePath, spaceFilter, parentPageId, auth, config) {
  const fileSpace = await hierarchyManager.getSpaceForPath(filePath, config.configPath)

  if (spaceFilter && fileSpace !== spaceFilter) {
    console.error(`  ⏭️  Skipping: File targets space '${fileSpace}' (filter is '${spaceFilter}')`)
    return
  }

  const title = await contentProcessor.extractTitle(filePath)
  let content = await contentProcessor.readFileContent(filePath)
  content = contentProcessor.filterContentForFormat(content, 'confluence')

  const githubUrl = github.getGitHubSourceUrl(filePath)

  let atlasContent
  let useAtlasFormat = false

  try {
    atlasContent = await contentProcessor.convertMarkdownToAtlasDoc(content)
    useAtlasFormat = true
    if (githubUrl) {
      atlasContent = contentProcessor.addWarningPanelToAtlas(atlasContent, githubUrl)
    }
  } catch (error) {
    console.error('  ⚠️  Warning: Falling back to storage format')
    if (githubUrl) {
      content = contentProcessor.addWarningPanelToContent(content, githubUrl, false)
    }
    atlasContent = contentProcessor.convertMarkdownToStorage(content)
    useAtlasFormat = false
  }

  const finalSpace = fileSpace || config.defaultSpace
  const fileParentId = await hierarchyManager.getParentForPath(filePath, finalSpace, parentPageId, auth)

  console.error(`  Publishing: ${title} (space: ${finalSpace})`)

  // Find existing page
  const existingPage = await apiClient.findPageByTitle(title, finalSpace, auth)
  let existingPageId = null
  let existingVersion = null
  let canUpdate = false

  if (existingPage.count > 0 && existingPage.page.results && existingPage.page.results.length > 0) {
    const page = existingPage.page.results[0]
    existingPageId = page.id
    existingVersion = page.version?.number || 1

    // Check if page is safe to update
    canUpdate = await pageManager.isPageSafeToUpdate(existingPageId, auth)

    if (!canUpdate) {
      console.error(`  ⏭️  Skipping: Page exists but is not safe to update (no 'generated' label)`)
      return // Return without incrementing stats (will be counted as skipped by caller)
    }

    // Handle archived/trashed pages
    const pageStatus = page.status || 'current'
    if (pageStatus !== 'current') {
      const statusResult = await pageManager.handlePageStatus(existingPageId, pageStatus, title, auth)
      if (!statusResult.usable) {
        existingPageId = null // Will create new page
      } else {
        existingPageId = statusResult.pageId
      }
    }
  }

  let publishedPageId = null

  if (existingPageId && canUpdate) {
    // Update existing page
    try {
      const payload = pageManager.createPagePayload(
        title,
        atlasContent,
        fileParentId,
        existingVersion + 1,
        finalSpace,
        useAtlasFormat
      )

      const response = await apiClient.confluenceRequest('PUT',
        `/content/${existingPageId}`,
        { auth, body: payload }
      )

      if (response.status === 200) {
        publishedPageId = existingPageId
        console.error(`  ✅ Updated successfully (ID: ${publishedPageId})`)
      } else if (response.status === 403) {
        // Permission error - try to handle it
        const errorResult = await pageManager.handle403Error(existingPageId, title, auth)
        if (!errorResult.canContinue) {
          throw new Error('Cannot update page: permission denied')
        }
        // Fall through to create new page
        existingPageId = null
      } else {
        throw new Error(`HTTP ${response.status}: ${utils.extractError(response.body)}`)
      }
    } catch (error) {
      if (error.message.includes('403')) {
        console.error(`  ❌ Permission denied: ${error.message}`)
        throw error
      }
      console.error(`  ❌ Failed to update: ${error.message}`)
      throw error
    }
  }

  if (!publishedPageId) {
    // Create new page
    try {
      const payload = pageManager.createPagePayload(
        title,
        atlasContent,
        fileParentId,
        null,
        finalSpace,
        useAtlasFormat
      )

      const response = await apiClient.confluenceRequest('POST',
        '/content',
        { auth, body: payload }
      )

      if (response.status === 200 || response.status === 201) {
        publishedPageId = response.body.id
        console.error(`  ✅ Created successfully (ID: ${publishedPageId})`)
      } else {
        throw new Error(`HTTP ${response.status}: ${utils.extractError(response.body)}`)
      }
    } catch (error) {
      console.error(`  ❌ Failed to create: ${error.message}`)
      throw error
    }
  }

  // Add generated label
  if (publishedPageId) {
    await pageManager.addLabelToPage(publishedPageId, config.generatedLabel || 'generated', auth)

    // Process images after page is created/updated
    // Extract image placeholders from content and upload them
    const contentStr = useAtlasFormat
      ? (typeof atlasContent === 'string' ? atlasContent : JSON.stringify(atlasContent))
      : content

    // Find LikeC4View and MermaidDiagram components
    const likec4Regex = /<LikeC4View[^>]*viewId="([^"]*)"[^>]*\/?>/g
    const mermaidRegex = /<MermaidDiagram[^>]*diagramId="([^"]*)"[^>]*\/?>/g
    const placeholders = []

    let match
    while ((match = likec4Regex.exec(contentStr)) !== null) {
      const viewId = match[1]
      const imagePath = await imageHandler.findDiagramImage(viewId, config.exportsDir || 'generated/diagrams')
      if (imagePath) {
        const attachmentData = await imageHandler.uploadImageAttachment(publishedPageId, imagePath, auth)
        if (attachmentData) {
          // Format: "attachmentId|fileId|filename"
          const attachmentInfo = `${attachmentData.attachmentId}|${attachmentData.fileId || ''}|${attachmentData.filename}`
          placeholders.push({ viewId, imagePath, attachmentInfo })
        }
      }
    }

    while ((match = mermaidRegex.exec(contentStr)) !== null) {
      const diagramId = match[1]
      const imagePath = await imageHandler.findMermaidDiagram(diagramId)
      if (imagePath) {
        const attachmentData = await imageHandler.uploadImageAttachment(publishedPageId, imagePath, auth)
        if (attachmentData) {
          // Format: "attachmentId|fileId|filename"
          const attachmentInfo = `${attachmentData.attachmentId}|${attachmentData.fileId || ''}|${attachmentData.filename}`
          placeholders.push({ viewId: diagramId, imagePath, attachmentInfo })
        }
      }
    }

    // Replace placeholders in the page content
    if (placeholders.length > 0) {
      if (useAtlasFormat) {
        const updatedAtlas = await imageHandler.replaceImagePlaceholdersAtlas(
          atlasContent,
          placeholders,
          publishedPageId
        )
        // Update the page with image placeholders replaced
        const updatePayload = pageManager.createPagePayload(
          title,
          updatedAtlas,
          fileParentId,
          existingVersion ? existingVersion + 2 : 2,
          finalSpace,
          true
        )
        await apiClient.confluenceRequest('PUT',
          `/content/${publishedPageId}`,
          { auth, body: updatePayload }
        )
      } else {
        const updatedContent = imageHandler.replaceImagePlaceholders(content, placeholders, 'storage')
        const updatePayload = pageManager.createPagePayload(
          title,
          updatedContent,
          fileParentId,
          existingVersion ? existingVersion + 2 : 2,
          finalSpace,
          false
        )
        await apiClient.confluenceRequest('PUT',
          `/content/${publishedPageId}`,
          { auth, body: updatePayload }
        )
      }
    }
  }
}

/**
 * Publish a diagram file
 */
async function publishDiagramFile (filePath, spaceFilter, parentPageId, auth, config) {
  const title = await contentProcessor.extractTitle(filePath)
  console.error(`  Publishing diagram: ${title}`)
}

// Export public API
module.exports = {
  publish,
  validateConfig,
  createConfigTemplate,

  // Export internal modules for advanced usage
  lib: {
    utils,
    apiClient,
    pageManager,
    contentProcessor,
    github,
    imageHandler,
    hierarchyManager
  }
}

