/**
 * Page management functions for Confluence
 * @module @defra/delivery-info-arch-tooling/confluence/page-manager
 */

const { confluenceRequest } = require('./api-client')
const { isNullOrEmpty } = require('./utils')

/**
 * Configuration (will be set by main module)
 */
let CONFIG = {
  generatedLabel: process.env.GENERATED_LABEL || 'generated'
}

/**
 * Set configuration (called by main module)
 * @param {Object} config - Configuration object
 */
function setConfig (config) {
  CONFIG = { ...CONFIG, ...config }
}

/**
 * Create page payload for Confluence API
 * @param {string} title - Page title
 * @param {string|Object} content - Page content
 * @param {string} parentId - Parent page ID
 * @param {string} version - Page version (for updates)
 * @param {string} spaceKey - Confluence space key
 * @param {boolean} useAtlasFormat - Use Atlas Document Format
 * @returns {Object} API payload
 */
function createPagePayload (title, content, parentId, version, spaceKey, useAtlasFormat) {
  const basePayload = {
    type: 'page',
    title,
    metadata: {
      properties: {
        'content-appearance-draft': {
          value: 'full-width'
        },
        'content-appearance-published': {
          value: 'full-width'
        }
      }
    }
  }

  if (version) {
    // Update payload
    basePayload.version = { number: parseInt(version, 10) }
  } else {
    // Create payload
    basePayload.space = { key: spaceKey }
    if (parentId && !isNullOrEmpty(parentId)) {
      basePayload.ancestors = [{ id: parentId }]
    }
  }

  if (useAtlasFormat) {
    // Parse content if it's a string (should be JSON)
    let atlasDoc
    if (typeof content === 'string') {
      try {
        atlasDoc = JSON.parse(content)
      } catch (e) {
        atlasDoc = content // Use as-is if not JSON
      }
    } else {
      atlasDoc = content
    }

    basePayload.body = {
      atlas_doc_format: {
        value: typeof atlasDoc === 'string' ? atlasDoc : JSON.stringify(atlasDoc),
        representation: 'atlas_doc_format'
      }
    }
  } else {
    // Storage format
    basePayload.body = {
      storage: {
        value: content,
        representation: 'storage'
      }
    }
  }

  return basePayload
}

/**
 * Check if a page has a specific label
 * @param {string} pageId - Page ID
 * @param {string} labelName - Label name
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<boolean>} True if page has label
 */
async function hasLabel (pageId, labelName, auth) {
  try {
    const response = await confluenceRequest('GET',
      `/content/${pageId}/label?limit=100`,
      { auth }
    )

    if (response.status === 200 && response.body && response.body.results) {
      return response.body.results.some(label => label.name === labelName)
    }
  } catch (error) {
    // Error checking labels - assume no label
  }

  return false
}

/**
 * Check if a page is safe to update (has "generated" label or doesn't exist)
 * @param {string} pageId - Page ID
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<boolean>} True if safe to update
 */
async function isPageSafeToUpdate (pageId, auth) {
  const generatedLabel = CONFIG.generatedLabel

  // Check if page has the generated label
  if (await hasLabel(pageId, generatedLabel, auth)) {
    return true // Safe to update - it's a generated page
  }

  // Check if page has protected labels (manual, protected)
  const protectedLabels = (process.env.PROTECTED_LABELS || 'manual,protected').split(',').map(l => l.trim())
  for (const label of protectedLabels) {
    if (await hasLabel(pageId, label, auth)) {
      return false // Protected - has manual/protected label
    }
  }

  // If page exists but has no generated label and no protected labels, it's an existing manual page
  // We should NOT update it by default (safer)
  return false // Not safe to update - existing page without generated label
}

/**
 * Add a label to a Confluence page
 * @param {string} pageId - Page ID
 * @param {string} labelName - Label name
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<boolean>} True if label was added
 */
async function addLabelToPage (pageId, labelName, auth) {
  // Check if label already exists
  if (await hasLabel(pageId, labelName, auth)) {
    return true // Label already exists
  }

  // Add label via REST API
  const payload = { name: labelName }

  try {
    const response = await confluenceRequest('POST',
      `/content/${pageId}/label`,
      {
        auth,
        body: payload
      }
    )

    if (response.status === 200 || response.status === 201) {
      console.error(`    → Added label '${labelName}' to page`)
      return true
    } else {
      console.error(`    ⚠️  Warning: Failed to add label '${labelName}' (HTTP ${response.status})`)
      return false
    }
  } catch (error) {
    console.error(`    ⚠️  Warning: Failed to add label '${labelName}': ${error.message}`)
    return false
  }
}

/**
 * Handle archived/trashed page restoration or deletion
 * Returns: { usable: boolean, pageId: string, title: string }
 * @param {string} pageId - Page ID
 * @param {string} pageStatus - Current page status
 * @param {string} title - Page title
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object>} Result object
 */
async function handlePageStatus (pageId, pageStatus, title, auth) {
  if (pageStatus !== 'archived' && pageStatus !== 'trashed') {
    return { usable: true, pageId, title }
  }

  if (pageStatus === 'archived') {
    // Try to restore archived page
    try {
      const response = await confluenceRequest('POST',
        `/content/${pageId}/restore`,
        { auth }
      )

      if (response.status === 200) {
        console.error(`    ✅ Restored archived page: ${title}`)
        return { usable: true, pageId, title }
      }
    } catch (error) {
      console.error(`    ⚠️  Warning: Could not restore page: ${error.message}`)
    }
  }

  if (pageStatus === 'trashed') {
    // Try to delete trashed page permanently
    try {
      const response = await confluenceRequest('DELETE',
        `/content/${pageId}?permanent=true`,
        { auth }
      )

      if (response.status === 204 || response.status === 200) {
        console.error(`    ✅ Deleted trashed page: ${title}`)
        return { usable: false, pageId: null, title: `${title} [NEW]` }
      }
    } catch (error) {
      if (error.message.includes('403')) {
        console.error('    ❌ Cannot delete page (HTTP 403 - no delete permission)')
        return { usable: false, pageId: null, title: `${title} [NEW]` }
      }
      console.error(`    ⚠️  Warning: Could not delete page: ${error.message}`)
    }
  }

  // If we can't restore/delete, suggest new title
  return { usable: false, pageId: null, title: `${title} [NEW]` }
}

/**
 * Handle HTTP 403 permission errors during update
 * @param {string} existingId - Existing page ID
 * @param {string} title - Page title
 * @param {Object} auth - Authentication credentials
 * @returns {Promise<Object>} Result object
 */
async function handle403Error (existingId, title, auth) {
  // Try to delete the page first
  try {
    const response = await confluenceRequest('DELETE',
      `/content/${existingId}?permanent=true`,
      { auth }
    )

    if (response.status === 204 || response.status === 200) {
      console.error(`    ✅ Deleted page to allow recreation: ${title}`)
      return { canContinue: true, pageId: null }
    }
  } catch (error) {
    // Continue to check delete permission
  }

  // Check if we can delete
  try {
    const response = await confluenceRequest('DELETE',
      `/content/${existingId}`,
      { auth }
    )

    if (response.status === 204 || response.status === 200) {
      return { canContinue: true, pageId: null }
    }
  } catch (error) {
    if (error.message.includes('403')) {
      console.error('    ❌ Cannot delete page (HTTP 403 - no delete permission)')
      console.error(`    ⚠️  ERROR: Cannot update or delete existing page '${title}' (ID: ${existingId})`)
      console.error('    → Your account does not have edit/delete permissions for this page')
      return { canContinue: false, pageId: existingId }
    }
  }

  return { canContinue: false, pageId: existingId }
}

module.exports = {
  setConfig,
  createPagePayload,
  hasLabel,
  isPageSafeToUpdate,
  addLabelToPage,
  handlePageStatus,
  handle403Error
}

