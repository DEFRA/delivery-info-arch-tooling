/**
 * Hierarchy and folder management functions for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/hierarchy-manager
 */

const fs = require('fs').promises
const path = require('path')
const apiClient = require('./api-client')
const pageManager = require('./page-manager')
const github = require('./github')
const { isNullOrEmpty } = require('./utils')

/**
 * Configuration (will be set by main module)
 */
let CONFIG = {
  confluenceUrl: process.env.CONFLUENCE_URL || 'https://eaflood.atlassian.net',
  defaultSpace: process.env.CONFLUENCE_SPACE || '',
  contentRoot: 'docs'
}

/**
 * Space mapping cache
 */
let spaceMappingCache = null

/**
 * Reset cache (for testing)
 */
function resetCache () {
  spaceMappingCache = null
}

/**
 * Set configuration (called by main module)
 * @param {Object} config - Configuration object
 */
function setConfig (config) {
  CONFIG = { ...CONFIG, ...config }
}

/**
 * Load space mapping from config file
 * @param {string} configPath - Optional config file path
 * @returns {Promise<Object|null>} Space mapping or null
 */
async function loadSpaceMapping (configPath) {
  if (spaceMappingCache !== null && !configPath) {
    return spaceMappingCache
  }

  // Use configPath from CONFIG if not provided
  const configFile = configPath || CONFIG.configPath || path.join(__dirname, '..', 'confluence-config.json')

  try {
    const configContent = await fs.readFile(configFile, 'utf-8')
    const config = JSON.parse(configContent)
    const mapping = config.spaceMapping || null
    if (!configPath) {
      spaceMappingCache = mapping // Only cache if using default path
    }
    return mapping
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Determine Confluence space from file path
 * @param {string} filePath - Path to file
 * @param {string} configPath - Optional config file path
 * @returns {Promise<string|null>} Space key or null
 */
async function getSpaceForPath (filePath, configPath) {
  const spaceMapping = await loadSpaceMapping(configPath)

  // Extract relative path
  let relPath = filePath
  if (filePath.startsWith('docs/')) {
    relPath = filePath.substring(5)
  } else if (filePath.startsWith('astro/src/content/docs/')) {
    relPath = filePath.substring(22)
  }

  // Check if path is under delivery-information-architecture
  if (relPath.startsWith('delivery-information-architecture/')) {
    relPath = relPath.substring('delivery-information-architecture/'.length)

    if (relPath.startsWith('systems/')) {
      const parts = relPath.split('/')
      if (parts.length >= 2) {
        const systemName = parts[1]
        if (spaceMapping && spaceMapping[systemName]) {
          return spaceMapping[systemName]
        }
      }
      return null
    }

    const tradeMatch = relPath.match(/^[Tt]rade\//)
    if (tradeMatch) {
      if (spaceMapping) {
        return spaceMapping.trade || spaceMapping.Trade || null
      }
      return null
    }
  }

  // Check if path is directly under systems/
  if (relPath.startsWith('systems/')) {
    const parts = relPath.split('/')
    if (parts.length >= 2) {
      const systemName = parts[1]
      if (spaceMapping && spaceMapping[systemName]) {
        return spaceMapping[systemName]
      }
    }
    return null
  }

  // Check if path is directly under Trade/
  const tradeMatch = relPath.match(/^[Tt]rade\//)
  if (tradeMatch) {
    if (spaceMapping) {
      return spaceMapping.trade || spaceMapping.Trade || null
    }
    return null
  }

  return null
}

/**
 * Get or create a folder page for hierarchy preservation
 * @param {string} folderName - Folder name
 * @param {string} parentId - Parent page ID
 * @param {string} spaceKey - Confluence space key
 * @param {string} folderPath - Folder path for GitHub URL
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<string>} Page ID
 */
async function getOrCreateFolder (folderName, parentId, spaceKey, folderPath, auth) {
  console.error(`  Creating/verifying folder: ${folderName} (space: ${spaceKey})`)

  const existingPage = await apiClient.getPageByTitle(folderName, spaceKey, auth)
  let pageId = null

  if (existingPage && existingPage.results && existingPage.results.length > 0) {
    pageId = existingPage.results[0].id

    const ancestors = existingPage.results[0].ancestors || []
    let existingParent = null

    if (ancestors.length > 0) {
      const lastAncestor = ancestors[ancestors.length - 1]
      if (lastAncestor && lastAncestor.type === 'page') {
        existingParent = lastAncestor.id
      }
    }

    const normalizedExistingParent = existingParent || ''
    const normalizedRequestedParent = parentId || ''

    if (normalizedExistingParent === normalizedRequestedParent) {
      console.error(`    ✅ Using existing folder: ${folderName} (ID: ${pageId})`)

      if (folderPath) {
        console.error(`    🔍 Calling updateFolderWithWarning for: ${folderName} (path: ${folderPath})`)
        await updateFolderWithWarning(folderName, pageId, folderPath, spaceKey, auth)
      }

      return pageId
    } else {
      console.error(`    ✅ Using existing folder: ${folderName} (ID: ${pageId})`)

      if (folderPath) {
        console.error(`    🔍 Calling updateFolderWithWarning for: ${folderName} (path: ${folderPath})`)
        await updateFolderWithWarning(folderName, pageId, folderPath, spaceKey, auth)
      }

      return pageId
    }
  }

  // Create folder page with ADF format
  const githubUrl = folderPath ? github.getGitHubSourceUrl(folderPath) : null

  const adfContent = {
    type: 'doc',
    version: 1,
    content: []
  }

  if (githubUrl) {
    adfContent.content.push({
      type: 'panel',
      attrs: {
        panelType: 'warning'
      },
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This page was automatically generated from ' },
            { type: 'text', marks: [{ type: 'link', attrs: { href: githubUrl } }], text: 'source on GitHub' },
            { type: 'text', text: '. Do not edit directly as your edits may be overwritten.' }
          ]
        }
      ]
    })
  }

  adfContent.content.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'This page organizes content from the ' },
      { type: 'text', marks: [{ type: 'code' }], text: folderName },
      { type: 'text', text: ' directory.' }
    ]
  })

  const payload = pageManager.createPagePayload(folderName, adfContent, parentId, null, spaceKey, true)

  try {
    const response = await apiClient.confluenceRequest('POST',
      '/content',
      {
        auth,
        body: payload
      }
    )

    if (response.status === 200 || response.status === 201) {
      const newPageId = response.body?.id || null
      if (newPageId) {
        console.error(`    ✅ Folder created: ${folderName} (ID: ${newPageId})`)
        await pageManager.addLabelToPage(newPageId, CONFIG.generatedLabel || 'generated', auth)
        return newPageId
      }
    }

    const bodyStr = typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
    if (bodyStr.includes('already exists') || bodyStr.includes('duplicate')) {
      const searchResult = await apiClient.searchPagesByTitle(folderName, spaceKey, auth)
      if (searchResult && searchResult.results && searchResult.results.length > 0) {
        const existingId = searchResult.results[0].id
        console.error(`    ✅ Using existing folder: ${folderName} (ID: ${existingId})`)
        return existingId
      }
    }
  } catch (error) {
    console.error(`    ⚠️  Failed to create folder: ${error.message}`)
  }

  console.error('    ⚠️  Failed to create folder, using parent ID instead')
  return parentId
}

/**
 * Update folder page with warning panel if missing or incorrect
 */
async function updateFolderWithWarning (folderName, pageId, folderPath, spaceKey, auth) {
  const githubUrl = github.getGitHubSourceUrl(folderPath)
  if (!githubUrl) {
    console.error(`    ⚠️  No GitHub URL for folder path: ${folderPath}`)
    return
  }

  try {
    const pageResponse = await apiClient.confluenceRequest('GET',
      `/content/${pageId}?expand=body.atlas_doc_format,body.storage,version`,
      { auth }
    )

    if (pageResponse.status !== 200) {
      console.error(`    ⚠️  Could not fetch page content (HTTP ${pageResponse.status})`)
      return
    }

    const storageBody = pageResponse.body?.body?.storage?.value || ''
    const atlasBody = pageResponse.body?.body?.atlas_doc_format?.value || ''

    const hasErrorPanelStorage = storageBody.includes('ac:name="error"') || storageBody.includes("ac:name='error'")
    const hasErrorPanelADF = atlasBody.includes('"panelType":"error"') || atlasBody.includes('"panelType": "error"')
    const hasWarningPanelADF = atlasBody.includes('"panelType":"warning"') || atlasBody.includes('"panelType": "warning"')
    const hasAutoGeneratedADF = atlasBody.includes('automatically generated from') || atlasBody.includes('source on GitHub')

    console.error(`    🔍 Panel check: errorInStorage=${hasErrorPanelStorage}, errorInADF=${hasErrorPanelADF}, warningInADF=${hasWarningPanelADF}, autoGenInADF=${hasAutoGeneratedADF}`)

    const shouldUpdate = hasErrorPanelStorage || hasErrorPanelADF || !hasWarningPanelADF || !hasAutoGeneratedADF

    if (!shouldUpdate) {
      console.error('    ✅ Folder page already has correct warning panel')
      return
    }

    console.error('    🔧 Updating folder page to fix panel type')

    const folderDescription = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'panel',
          attrs: {
            panelType: 'warning'
          },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'This page was automatically generated from ' },
                { type: 'text', marks: [{ type: 'link', attrs: { href: githubUrl } }], text: 'source on GitHub' },
                { type: 'text', text: '. Do not edit directly as your edits may be overwritten.' }
              ]
            }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This page organizes content from the ' },
            { type: 'text', marks: [{ type: 'code' }], text: folderName },
            { type: 'text', text: ' directory.' }
          ]
        }
      ]
    }

    const currentVersion = pageResponse.body?.version?.number || 1
    const nextVersion = currentVersion + 1

    const updatePayload = {
      id: pageId,
      type: 'page',
      title: folderName,
      space: { key: spaceKey },
      body: {
        atlas_doc_format: {
          value: JSON.stringify(folderDescription),
          representation: 'atlas_doc_format'
        }
      },
      version: { number: nextVersion }
    }

    const updateResponse = await apiClient.confluenceRequest('PUT',
      `/content/${pageId}`,
      {
        auth,
        body: updatePayload
      }
    )

    if (updateResponse.status === 200) {
      console.error('    ✅ Updated folder page with correct warning panel (ADF format)')
    } else {
      console.error(`    ⚠️  Warning: Could not update folder page (HTTP ${updateResponse.status})`)
    }
  } catch (error) {
    console.error(`    ⚠️  Warning: Could not update folder page: ${error.message}`)
  }
}

/**
 * Get parent page ID for a file path (preserving hierarchy)
 * @param {string} filePath - Path to file
 * @param {string} spaceKey - Confluence space key
 * @param {string} baseParentId - Base parent page ID
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<string>} Parent page ID
 */
async function getParentForPath (filePath, spaceKey, baseParentId, auth) {
  let relPath = filePath
  if (filePath.startsWith('docs/')) {
    relPath = filePath.substring(5)
  } else if (filePath.startsWith('astro/src/content/docs/')) {
    relPath = filePath.substring(22)
  }

  if (relPath.startsWith('delivery-information-architecture/')) {
    relPath = relPath.substring('delivery-information-architecture/'.length)
  }

  const originalRelPath = relPath
  if (/^[Ss]ystems\//.test(relPath)) {
    relPath = relPath.replace(/^[Ss]ystems\/[^/]+\//, '')
  } else if (/^[Tt]rade\//.test(relPath)) {
    relPath = relPath.replace(/^[Tt]rade\//, '')
  }

  const dirPath = path.dirname(relPath)

  if (dirPath === '.' || dirPath === '') {
    return baseParentId
  }

  let currentParent = baseParentId
  const parts = dirPath.split('/').filter(p => p && p !== '.')

  const originalDirPath = path.dirname(originalRelPath)
  const originalDirParts = originalDirPath !== '.' && originalDirPath !== '' ? originalDirPath.split('/') : []

  let startIdx = 0
  if (/^[Ss]ystems\//.test(originalRelPath)) {
    startIdx = 2
  } else if (/^[Tt]rade\//.test(originalRelPath)) {
    startIdx = 1
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part && part !== '.') {
      let folderName
      if (part === 'Technology View' || part === 'Current State Views' || part === 'Delivery Information Architecture') {
        folderName = part
      } else {
        folderName = part.replace(/-/g, ' ')
      }

      const partIdx = startIdx + i
      let originalPart = ''
      if (partIdx < originalDirParts.length) {
        originalPart = originalDirParts[partIdx]
      }

      if (!originalPart) {
        originalPart = part
      }

      const githubPathParts = []
      for (let j = 0; j <= partIdx; j++) {
        if (j < originalDirParts.length) {
          githubPathParts.push(originalDirParts[j])
        }
      }

      const currentFolderPath = `docs/${githubPathParts.join('/')}`

      console.error(`    → Processing folder: ${folderName} (parent: ${currentParent || 'ROOT'}, space: ${spaceKey || CONFIG.defaultSpace}, path: ${currentFolderPath})`)
      const newParent = await module.exports.getOrCreateFolder(folderName, currentParent, spaceKey, currentFolderPath, auth)
      if (!newParent || isNullOrEmpty(newParent)) {
        console.error(`    ⚠️  Warning: Failed to get/create folder '${folderName}', using base parent`)
        currentParent = baseParentId
      } else {
        currentParent = newParent
      }
    }
  }

  return currentParent
}

module.exports = {
  setConfig,
  loadSpaceMapping,
  getSpaceForPath,
  getParentForPath,
  getOrCreateFolder,
  resetCache
}

