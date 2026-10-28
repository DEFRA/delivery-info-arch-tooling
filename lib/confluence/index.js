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
const { createLinkResolver } = require('./lib/link-resolver')
const { createLinkVerifier, checkExternalUrl } = require('./lib/link-verifier')

function normalizeGlobPattern (filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

/**
 * Expand the config's publishPaths into the files each entry names, in
 * config order. The publish loop and the link resolver both read this,
 * so they agree on which files are published.
 *
 * A glob entry lists the regular files it matches, each marked with
 * whether the entry's exclude patterns drop it; `matched` counts every
 * glob match, files or not. A single-file entry lists its one path,
 * unchecked: the publish loop reports a missing file when it gets there.
 * Exclude patterns apply to glob entries only.
 *
 * @param {Object} config - Parsed confluence-config.json
 * @param {string} contentRoot - Root directory for content
 * @returns {Promise<Array<{pathType: string, isGlob: boolean, pattern: string, matched: number, files: Array<{file: string, excluded: boolean}>}>>}
 */
async function expandPublishPaths (config, contentRoot) {
  const { glob } = require('glob')
  const entries = []

  if (!Array.isArray(config.publishPaths)) {
    return entries
  }

  for (const pathConfig of config.publishPaths) {
    if (!pathConfig.path) continue

    const pathType = pathConfig.type || 'markdown'
    const fullPath = path.isAbsolute(pathConfig.path)
      ? pathConfig.path
      : path.join(contentRoot, pathConfig.path)

    if (!pathConfig.path.includes('*')) {
      entries.push({ pathType, isGlob: false, pattern: fullPath, matched: 1, files: [{ file: fullPath, excluded: false }] })
      continue
    }

    const pattern = normalizeGlobPattern(fullPath)
    const matches = await glob(pattern)
    const files = []
    for (const file of matches) {
      const stat = await fs.stat(file)
      if (stat.isFile()) {
        files.push({ file, excluded: shouldExcludeFile(file, pathConfig.exclude || [], contentRoot) })
      }
    }
    entries.push({ pathType, isGlob: true, pattern, matched: matches.length, files })
  }

  return entries
}

/**
 * The markdown files a publish run would publish, as absolute paths
 * @param {Array} entries - Result of expandPublishPaths
 * @returns {Set<string>} Absolute paths of publishable markdown files
 */
function publishableMarkdownFiles (entries) {
  const files = new Set()
  for (const entry of entries) {
    if (entry.pathType === 'diagram') continue
    for (const { file, excluded } of entry.files) {
      if (!excluded) files.add(path.resolve(file))
    }
  }
  return files
}

/**
 * Validate configuration file
 * @param {string} configPath - Path to confluence-config.json
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
function validateConfig(configPath) {
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
async function createConfigTemplate(outputPath) {
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
 * @param {boolean} options.dryRun - Resolve and report actions without writing
 * @returns {Promise<Object>} Publishing results { success: number, failed: number, skipped: number }
 */
async function publish(options) {
  const {
    configPath,
    spaceFilter = null,
    fileFilter = null,
    parentPageId = null,
    auth,
    contentRoot = 'docs',
    confluenceUrl = process.env.CONFLUENCE_URL || 'https://eaflood.atlassian.net',
    dryRun = false
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

  const effectiveDryRun = Boolean(dryRun || config.options?.dryRun)

  // Configure modules
  const moduleConfig = {
    confluenceUrl,
    defaultSpace: process.env.CONFLUENCE_SPACE || '',
    contentRoot,
    generatedLabel: process.env.GENERATED_LABEL || 'generated',
    dryRun: effectiveDryRun,
    configPath, // Pass configPath to hierarchy manager for space mapping
    sourceDir: process.env.LIKEC4_SOURCE_DIR || 'architecture', // Source directory for LikeC4 diagrams
    exportsDir: process.env.LIKEC4_EXPORTS_DIR || 'generated/diagrams' // Output directory for exported diagrams
  }

  apiClient.setConfig(moduleConfig)
  pageManager.setConfig(moduleConfig)
  imageHandler.setConfig(moduleConfig)
  hierarchyManager.setConfig(moduleConfig)

  const entries = await expandPublishPaths(config, contentRoot)

  // Relative .md links resolve against every file the config publishes, even under a file filter
  const linkResolver = createLinkResolver({
    publishableFiles: publishableMarkdownFiles(entries),
    extractTitle: (filePath) => contentProcessor.extractTitle(filePath),
    // Same space rule as publishMarkdownFile: the mapped space, else the default space
    getSpaceForPath: async (filePath) =>
      (await hierarchyManager.getSpaceForPath(path.relative(process.cwd(), filePath), configPath)) || moduleConfig.defaultSpace || null,
    findPageId: (title, spaceKey) => apiClient.findCurrentPageId(title, spaceKey, auth),
    getGitHubSourceUrl: (filePath) => github.getGitHubSourceUrl(filePath),
    confluenceUrl
  })
  const fileConfig = { ...moduleConfig, configPath, linkResolver }

  // Statistics
  const stats = {
    success: 0,
    failed: 0,
    skipped: 0,
    brokenLinks: 0,
    unreachableLinks: 0
  }
  const published = []

  // Resolve fileFilter to an absolute path once for comparison
  let resolvedFileFilter = null
  if (fileFilter) {
    resolvedFileFilter = path.isAbsolute(fileFilter)
      ? fileFilter
      : path.resolve(fileFilter)
    console.error(`  📄 File filter active: ${resolvedFileFilter}`)
  }

  for (const entry of entries) {
    if (entry.isGlob && entry.matched === 0) {
      console.error(`  ⚠️  No files matched: ${entry.pattern}`)
      stats.skipped++
      continue
    }

    for (const { file, excluded } of entry.files) {
      if (resolvedFileFilter && path.resolve(file) !== resolvedFileFilter) {
        stats.skipped++
        continue
      }

      if (excluded) {
        stats.skipped++
        continue
      }

      try {
        if (!entry.isGlob) {
          await fs.access(file)
        }
        if (entry.pathType === 'diagram') {
          await publishDiagramFile(file, spaceFilter, parentPageId, auth, fileConfig)
        } else {
          const pageId = await publishMarkdownFile(file, spaceFilter, parentPageId, auth, fileConfig)
          if (pageId) {
            published.push({ id: String(pageId), sourceUrl: github.getGitHubSourceUrl(file) })
          }
        }
        stats.success++
      } catch (error) {
        if (!entry.isGlob && error.code === 'ENOENT') {
          console.error(`  ⚠️  File not found: ${file}`)
        } else {
          console.error(`  ❌ Failed to publish ${file}: ${error.message}`)
        }
        stats.failed++
      }
    }
  }

  if (!effectiveDryRun && published.length > 0) {
    const verification = await verifyPublishedLinks(published, auth, confluenceUrl)
    stats.brokenLinks = verification.broken.length
    stats.unreachableLinks = verification.unreachable.length
  }

  return stats
}

/**
 * Check every link on the pages a run published, and report the result
 * @param {Array<{id: string, sourceUrl: string|null}>} published - Pages the run published
 * @param {Object} auth - Authentication credentials
 * @param {string} confluenceUrl - Confluence base URL
 * @returns {Promise<Object>} The verifier's result
 */
async function verifyPublishedLinks (published, auth, confluenceUrl) {
  const verifier = createLinkVerifier({
    confluenceUrl,
    fetchPage: async (pageId) => {
      const response = await apiClient.confluenceRequest('GET', `/content/${pageId}?expand=body.atlas_doc_format`, { auth })
      if (response.status === 404) {
        return null
      }
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}`)
      }
      const value = response.body?.body?.atlas_doc_format?.value
      return { title: response.body.title, adf: value ? JSON.parse(value) : { type: 'doc', content: [] } }
    },
    checkExternal: (url) => checkExternalUrl(url)
  })

  console.error('')
  console.error(`🔗 Checking the links on ${published.length} published page(s)...`)
  const result = await verifier.verify(published)
  for (const { page, href, reason } of result.broken) {
    console.error(`  ❌ Broken link on '${page}': ${href} (${reason})`)
  }
  for (const { page, href, reason } of result.unreachable) {
    console.error(`  ⚠️  External link not reachable from here on '${page}': ${href} (${reason})`)
  }
  console.error(`  🔗 Links checked: ${result.links} on ${result.pages} page(s); broken ${result.broken.length}, external unreachable ${result.unreachable.length}`)
  return result
}

/**
 * Check if file should be excluded
 */
function shouldExcludeFile(filePath, excludePatterns, contentRoot) {
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
async function publishMarkdownFile(filePath, spaceFilter, parentPageId, auth, config) {
  const fileSpace = await hierarchyManager.getSpaceForPath(filePath, config.configPath)

  if (spaceFilter && fileSpace !== spaceFilter) {
    console.error(`  ⏭️  Skipping: File targets space '${fileSpace}' (filter is '${spaceFilter}')`)
    return
  }

  const title = await contentProcessor.extractTitle(filePath)
  let content = await contentProcessor.readFileContent(filePath)
  content = contentProcessor.filterContentForFormat(content, 'confluence')
  if (config.linkResolver) {
    content = await config.linkResolver.rewriteLinks(content, path.resolve(filePath))
  }

  const githubUrl = github.getGitHubSourceUrl(filePath)

  // Check if content contains LikeC4View or MermaidDiagram components - these need special processing
  const likec4TestRegex = /<LikeC4View[^>]*viewId="([^"]*)"[^>]*\/?>/g
  const mermaidTestRegex = /<MermaidDiagram[^>]*diagramId="([^"]*)"[^>]*\/?>/g
  const hasLikeC4View = likec4TestRegex.test(content)
  const hasMermaidDiagram = mermaidTestRegex.test(content)
  let atlasContent
  let useAtlasFormat = false
  let diagramPlaceholders = []

  // Process MermaidDiagram components before conversion (replace with placeholders)
  let processedContent = content
  const mermaidPlaceholders = []
  if (hasMermaidDiagram) {
    mermaidTestRegex.lastIndex = 0 // Reset regex
    let match
    while ((match = mermaidTestRegex.exec(content)) !== null) {
      const diagramId = match[1]
      // Optional width="N" on tag limits Confluence display width (pixels)
      const tagSlice = content.slice(match.index, match.index + 500)
      const widthMatch = tagSlice.match(/width="(\d+)"/)
      const publishWidth = widthMatch ? parseInt(widthMatch[1], 10) : null
      const mmdDir = config.mmdDir || null
      const mmdOutputDir = config.mmdOutputDir || 'build/mmd'
      const imagePath = await imageHandler.findMermaidDiagram(diagramId, mmdDir, mmdOutputDir)

      if (imagePath) {
        mermaidPlaceholders.push({
          viewId: diagramId,
          imagePath,
          filename: path.basename(imagePath),
          ...(publishWidth && { width: publishWidth })
        })

        // Auto-append a "Diagram source" link to the .mmd on GitHub beneath the
        // image (disable with options.mermaidSourceLink: false in config)
        let replacement = `<ac:image-placeholder-viewid="${diagramId}"/>`
        if (config.options?.mermaidSourceLink !== false) {
          const mmdSource = await imageHandler.findMermaidSource(diagramId, mmdDir)
          const caption = mmdSource ? github.getDiagramSourceCaption(mmdSource) : null
          if (caption) {
            replacement += `\n\n${caption}`
            console.error(`    → Linking Mermaid diagram '${diagramId}' to source: ${mmdSource}`)
          } else {
            console.error(`    ⚠️  No source link for Mermaid diagram '${diagramId}' (source file or GitHub repo not found)`)
          }
        }

        processedContent = processedContent.replace(
          new RegExp(`<MermaidDiagram[^>]*diagramId="${diagramId}"[^>]*/>`, 'g'),
          () => replacement // function form so '$' in captions is never treated as a pattern
        )
        processedContent = processedContent.replace(
          new RegExp(`<MermaidDiagram[^>]*diagramId="${diagramId}"[^>]*>.*?</MermaidDiagram>`, 'gs'),
          () => replacement // function form so '$' in captions is never treated as a pattern
        )

        console.error(`    → Found Mermaid diagram image for '${diagramId}': ${path.basename(imagePath)}`)
      } else {
        console.error(`    ⚠️  No Mermaid diagram image found for '${diagramId}'`)
        processedContent = processedContent.replace(
          new RegExp(`<MermaidDiagram[^>]*diagramId="${diagramId}"[^>]*/>`, 'g'),
          `*Mermaid diagram for '${diagramId}' not available*`
        )
      }
    }
  }

  if (hasLikeC4View) {
    // Use convertDiagramPage which properly handles LikeC4View components
    const exportsDir = config.exportsDir || 'generated/diagrams'
    const sourceDir = config.sourceDir || 'architecture'
    const diagramResult = await imageHandler.convertDiagramPage(filePath, title, exportsDir, sourceDir, processedContent)
    atlasContent = diagramResult.content
    useAtlasFormat = diagramResult.useAtlasFormat
    diagramPlaceholders = [...diagramResult.placeholders || [], ...mermaidPlaceholders]

    if (githubUrl && useAtlasFormat) {
      atlasContent = contentProcessor.addWarningPanelToAtlas(atlasContent, githubUrl)
    } else if (githubUrl && !useAtlasFormat) {
      // For storage format, we'd need to add warning panel differently
      // But convertDiagramPage should handle this
    }
  } else {
    // Normal markdown conversion flow (but with Mermaid diagrams already processed)
    try {
      atlasContent = await contentProcessor.convertMarkdownToAtlasDoc(processedContent)
      useAtlasFormat = true
      diagramPlaceholders = mermaidPlaceholders
      if (githubUrl) {
        atlasContent = contentProcessor.addWarningPanelToAtlas(atlasContent, githubUrl)
      }
    } catch (error) {
      console.error('  ⚠️  Warning: Falling back to storage format')
      if (githubUrl) {
        processedContent = contentProcessor.addWarningPanelToContent(processedContent, githubUrl, false)
      }
      atlasContent = contentProcessor.convertMarkdownToStorage(processedContent)
      useAtlasFormat = false
      diagramPlaceholders = mermaidPlaceholders
    }
  }

  const finalSpace = fileSpace || config.defaultSpace
  let fileParentId = await hierarchyManager.getParentForPath(filePath, finalSpace, parentPageId, auth)

  // A page may name its parent by title in frontmatter (confluence.parent).
  // The named page replaces the folder-derived parent on create and on update.
  const parentTitle = await contentProcessor.extractConfluenceParent(filePath)
  const reparent = Boolean(parentTitle)
  if (parentTitle) {
    const parentLookup = await apiClient.findPageByTitle(parentTitle, finalSpace, auth)
    const parentPage = parentLookup.count > 0 && parentLookup.page.results && parentLookup.page.results[0]
    if (!parentPage) {
      throw new Error(`Parent page '${parentTitle}' named in frontmatter not found in space ${finalSpace}; publish the parent first`)
    }
    fileParentId = parentPage.id
    console.error(`    → Parent from frontmatter: '${parentTitle}' (ID: ${fileParentId})`)
  }

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

  if (config.dryRun) {
    if (existingPageId && canUpdate) {
      console.error(`  🧪 Dry run: would update '${title}' (space: ${finalSpace}, page ID: ${existingPageId}${reparent ? `, parent: ${fileParentId}` : ''})`)
    } else {
      console.error(`  🧪 Dry run: would create '${title}' (space: ${finalSpace}${fileParentId ? `, parent: ${fileParentId}` : ', parent: ROOT'})`)
    }
    return
  }

  // Every image the page shows, in page order: the diagram placeholders, then
  // the markdown images. A markdown path repeated on the page is listed once,
  // because imageHandler.replaceMediaPlaceholderInNode replaces every matching node.
  const imageRefs = diagramPlaceholders
    .filter(placeholder => placeholder.imagePath)
    .map(({ viewId, imagePath }) => ({ viewId, imagePath }))
  for (const img of await findMarkdownImages(content, filePath, diagramPlaceholders)) {
    if (!imageRefs.some(ref => ref.originalPath === img.originalPath)) {
      imageRefs.push({ viewId: img.filename, imagePath: img.imagePath, originalPath: img.originalPath })
    }
  }

  // The page's current attachment when its bytes already match the image file,
  // else a fresh upload. Null when the image could not be attached.
  const attachImage = async (pageId, imagePath) => {
    const unchanged = await imageHandler.findUnchangedAttachment(pageId, imagePath, auth)
    if (unchanged) {
      return { attachment: unchanged, uploaded: false }
    }
    const uploaded = await imageHandler.uploadImageAttachment(pageId, imagePath, auth, filePath)
    return uploaded ? { attachment: uploaded, uploaded: true } : null
  }

  // Attach every image to the page before the body that references them is
  // written, each image file once: a diagram used twice would otherwise be
  // uploaded twice in a row, and the second upload of the same attachment can
  // fail with HTTP 500. Diagram paths arrive relative to the working directory
  // and markdown image paths absolute, so the key is the resolved path.
  // Returns the placeholders for the body and the names of the images that failed.
  const attachImages = async (pageId) => {
    const attachmentsByPath = new Map()
    const placeholders = []
    const failed = []
    for (const ref of imageRefs) {
      const key = path.resolve(ref.imagePath)
      const firstUse = !attachmentsByPath.has(key)
      if (firstUse) {
        attachmentsByPath.set(key, await attachImage(pageId, ref.imagePath))
      }
      const attached = attachmentsByPath.get(key)
      const name = path.basename(ref.imagePath)
      if (!attached) {
        if (!failed.includes(name)) failed.push(name)
        continue
      }
      const { attachmentId, fileId, filename } = attached.attachment
      // Format: "attachmentId|fileId|filename"
      placeholders.push({ ...ref, attachmentInfo: `${attachmentId}|${fileId || ''}|${filename}` })
      if (ref.originalPath && firstUse && attached.uploaded) {
        console.error(`    → Uploaded manual diagram: ${name}`)
      }
    }
    return { placeholders, failed }
  }

  const uploadsFailed = (failed) => new Error(`${failed.length} image upload(s) failed: ${failed.join(', ')}`)

  // The page body with a media node in place of every image stub. The atlas
  // replacement edits the document it is given, so it works on a copy: the
  // stubs must survive for the create that follows a refused update.
  const bodyWithImages = async (pageId, placeholders) => {
    if (placeholders.length === 0) {
      return atlasContent
    }
    if (useAtlasFormat) {
      const copy = typeof atlasContent === 'string' ? atlasContent : structuredClone(atlasContent)
      return imageHandler.replaceImagePlaceholdersAtlas(copy, placeholders, pageId)
    }
    // For storage format, replace placeholders in the original content
    return imageHandler.replaceImagePlaceholders(content, placeholders, 'storage')
  }

  let publishedPageId = null

  if (existingPageId && canUpdate) {
    // Update existing page: images first, so the one write holds them all and
    // a failed upload leaves the page at its last good version
    const { placeholders, failed } = await attachImages(existingPageId)
    if (failed.length > 0) {
      throw uploadsFailed(failed)
    }
    const body = await bodyWithImages(existingPageId, placeholders)

    try {
      const payload = pageManager.createPagePayload(
        title,
        body,
        fileParentId,
        existingVersion + 1,
        finalSpace,
        useAtlasFormat,
        reparent
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

  if (publishedPageId) {
    await pageManager.addLabelToPage(publishedPageId, config.generatedLabel || 'generated', auth)
    return publishedPageId
  }

  // Create new page. Its id does not exist before the create, so the page is
  // written with its image stubs, the images attached, then written once more
  // with their media nodes. A failed upload leaves it at its first version.
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

  await pageManager.addLabelToPage(publishedPageId, config.generatedLabel || 'generated', auth)

  const { placeholders, failed } = await attachImages(publishedPageId)
  if (failed.length > 0) {
    throw uploadsFailed(failed)
  }

  if (placeholders.length > 0) {
    const payload = pageManager.createPagePayload(
      title,
      await bodyWithImages(publishedPageId, placeholders),
      fileParentId,
      2,
      finalSpace,
      useAtlasFormat
    )
    const response = await apiClient.confluenceRequest('PUT',
      `/content/${publishedPageId}`,
      { auth, body: payload }
    )
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${utils.extractError(response.body)}`)
    }
  }

  return publishedPageId
}

/**
 * The markdown images on a page that resolve to a file on disk, in page order.
 * A web URL is left to Confluence; a /likec4-exports/ image that a LikeC4View
 * placeholder already covers is skipped. An image that is not on disk is
 * reported and left out.
 * @param {string} content - The page's markdown
 * @param {string} filePath - The page's path, which relative image paths resolve against
 * @param {Array} diagramPlaceholders - The page's LikeC4 and Mermaid placeholders
 * @returns {Promise<Array<{imagePath: string, originalPath: string, filename: string}>>} The images, imagePath absolute
 */
async function findMarkdownImages (content, filePath, diagramPlaceholders) {
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const images = []
  let match
  while ((match = imageRegex.exec(content)) !== null) {
    const imagePath = match[2]

    // Skip absolute URLs (http/https)
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      continue
    }

    // Skip /likec4-exports/ images that already have a LikeC4View placeholder
    // (those are handled by convertDiagramPage). But allow /likec4-exports/
    // images that don't correspond to a LikeC4View (e.g. sequence diagram PNGs).
    const viewIdFromFilename = path.basename(imagePath, path.extname(imagePath))
    if (imagePath.startsWith('/likec4-exports/') && diagramPlaceholders.some(p => p.viewId === viewIdFromFilename)) {
      continue
    }

    // /likec4-exports/ paths resolve relative to astro/public, the rest to the page
    const absoluteImagePath = imagePath.startsWith('/likec4-exports/')
      ? path.join(process.cwd(), 'astro', 'public', imagePath)
      : path.resolve(path.dirname(filePath), imagePath)

    try {
      await fs.access(absoluteImagePath)
      images.push({ imagePath: absoluteImagePath, originalPath: imagePath, filename: path.basename(absoluteImagePath) })
    } catch (e) {
      console.error(`    ⚠️  Image not found: ${imagePath} (resolved to: ${absoluteImagePath})`)
    }
  }
  return images
}

/**
 * Publish a diagram file
 */
async function publishDiagramFile(filePath, spaceFilter, parentPageId, auth, config) {
  const title = await contentProcessor.extractTitle(filePath)
  console.error(`  Publishing diagram: ${title}`)
}

// Export public API
module.exports = {
  publish,
  validateConfig,
  createConfigTemplate,
  expandPublishPaths,

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
