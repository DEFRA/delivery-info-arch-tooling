#!/usr/bin/env node

/**
 * Convert standard markdown to PowerPoint via Marp
 * 
 * This script converts format-agnostic markdown to PPTX in one step:
 * 1. Converts markdown to Marp format
 * 2. Generates PPTX using Marp CLI
 * 
 * The source markdown remains clean and works for:
 * - GitHub Pages (Astro)
 * - Confluence publishing
 * - PPT generation (via Marp)
 * 
 * Usage:
 *   node scripts/ppt/md-to-pptx-marp.js <input.md> [options]
 */

const { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } = require('fs');
const { execSync } = require('child_process');
const { join, dirname, basename, resolve, extname, relative } = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  let inputFile = null;
  let outputFile = null;
  let theme = 'defra';
  let title = null;
  let author = null;
  let date = null;
  let version = null;
  let cssFile = 'defra-marp-theme.css';
  let keepMarp = false;
  let applyTemplate = false;
  let templateFile = null;
  let headingLevel = 1; // Default to H1 for slide breaks
  let editable = false; // Generate editable PPTX (requires LibreOffice Impress)

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      outputFile = args[++i];
    } else if (args[i] === '--theme') {
      theme = args[++i] || 'defra';
    } else if (args[i] === '--title') {
      title = args[++i];
    } else if (args[i] === '--author') {
      author = args[++i];
    } else if (args[i] === '--date') {
      date = args[++i];
    } else if (args[i] === '--version') {
      version = args[++i];
    } else if (args[i] === '--css') {
      cssFile = args[++i] || 'defra-marp-theme.css';
    } else if (args[i] === '--keep-marp') {
      keepMarp = true;
    } else if (args[i] === '--apply-template' || args[i] === '--template') {
      applyTemplate = true;
      if (args[i + 1] && !args[i + 1].startsWith('-')) {
        templateFile = args[++i];
      }
    } else if (args[i] === '--heading-level' || args[i] === '--slide-heading') {
      const level = parseInt(args[++i], 10);
      if (level >= 1 && level <= 6) {
        headingLevel = level;
      } else {
        console.warn(`Warning: Invalid heading level ${level}, using default (1)`);
      }
    } else if (args[i] === '--editable' || args[i] === '--pptx-editable') {
      editable = true;
    } else if (!inputFile && !args[i].startsWith('-')) {
      inputFile = args[i];
    }
  }

  return { inputFile, outputFile, theme, title, author, date, version, cssFile, keepMarp, applyTemplate, templateFile, headingLevel, editable };
}

// ====================
// Markdown to Marp Conversion Functions
// ====================

function extractFrontmatter(content) {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
  const match = content.match(frontmatterRegex);

  if (match) {
    const frontmatterText = match[1];
    const frontmatter = {};

    // Parse YAML-like frontmatter
    frontmatterText.split('\n').forEach(line => {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim().replace(/^["']|["']$/g, '');
        frontmatter[key] = value;
      }
    });

    return {
      frontmatter,
      content: content.substring(match[0].length)
    };
  }

  return { frontmatter: {}, content };
}

/**
 * Recursively search for a file in a directory
 */
function findFileRecursive(dir, filename) {
  if (!existsSync(dir)) return null;
  
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          const found = findFileRecursive(filePath, filename);
          if (found) return found;
        } else if (file === filename) {
          return filePath;
        }
      } catch (e) {
        // Skip inaccessible files
      }
    }
  } catch (e) {
    // Skip inaccessible directories
  }
  return null;
}

function findDiagramImage(viewId, inputFile, rootDir) {
  // Try to find exported diagram image in common locations
  // Priority: generated/diagrams (new) > astro/likec4-exports (legacy) > other locations
  const inputDir = dirname(inputFile);
  
  // 1. First, check generated/diagrams (flat and recursive) - this is the preferred location
  const generatedDir = join(rootDir, 'generated', 'diagrams');
  for (const ext of ['.png', '.svg']) {
    // Flat check
    const flatPath = join(generatedDir, `${viewId}${ext}`);
    if (existsSync(flatPath)) {
      return calculateRelativePath(flatPath, inputDir);
    }
    // Recursive check (for nested structure like current/btms/c4/viewId.png)
    const found = findFileRecursive(generatedDir, `${viewId}${ext}`);
    if (found) {
      return calculateRelativePath(found, inputDir);
    }
  }
  
  // 2. Check astro/likec4-exports (legacy location, flat and recursive)
  const legacyDir = join(rootDir, 'astro', 'likec4-exports');
  for (const ext of ['.png', '.svg']) {
    const flatPath = join(legacyDir, `${viewId}${ext}`);
    if (existsSync(flatPath)) {
      return calculateRelativePath(flatPath, inputDir);
    }
    const found = findFileRecursive(legacyDir, `${viewId}${ext}`);
    if (found) {
      return calculateRelativePath(found, inputDir);
    }
  }
  
  // 3. Check other locations (architecture/export, relative to input file)
  const otherLocations = [
    join(rootDir, 'architecture', 'export', `${viewId}.png`),
    join(rootDir, 'architecture', 'export', `${viewId}.svg`),
    join(inputDir, 'images', `${viewId}.png`),
    join(inputDir, 'images', `${viewId}.svg`),
  ];

  for (const path of otherLocations) {
    if (existsSync(path)) {
      return calculateRelativePath(path, inputDir);
    }
  }

  // If not found, return null (will use placeholder)
  return null;
}

function calculateRelativePath(imagePath, inputDir) {
  let relativePath = relative(inputDir, imagePath);
  // Normalize path separators for markdown (use forward slashes)
  relativePath = relativePath.replace(/\\/g, '/');
  // Ensure path starts with ./ or ../ for relative paths
  if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
    relativePath = './' + relativePath;
  }
  return relativePath;
}

function convertAbsoluteImagePaths(markdown, inputFile, rootDir) {
  // Convert absolute /docs/... paths to relative paths for PPT generation
  // Also handle <img src="/docs/..."> in HTML figure tags
  const inputDir = dirname(inputFile);
  
  // Match markdown images: ![alt](/docs/...)
  markdown = markdown.replace(/!\[([^\]]*)\]\((\/docs\/[^)]+)\)/g, (match, alt, absPath) => {
    // Convert /docs/... to actual file path
    const actualPath = join(rootDir, absPath.substring(1)); // Remove leading /
    if (existsSync(actualPath)) {
      const relPath = calculateRelativePath(actualPath, inputDir);
      return `![${alt}](${relPath})`;
    } else {
      console.warn(`⚠️  Warning: Image not found: ${absPath} (resolved to: ${actualPath})`);
      return match; // Keep original if not found
    }
  });
  
  // Match HTML img tags in figures: <img src="/docs/...">
  markdown = markdown.replace(/<img\s+src="(\/docs\/[^"]+)"([^>]*)>/gi, (match, absPath, attrs) => {
    // Convert /docs/... to actual file path
    const actualPath = join(rootDir, absPath.substring(1)); // Remove leading /
    if (existsSync(actualPath)) {
      const relPath = calculateRelativePath(actualPath, inputDir);
      return `<img src="${relPath}"${attrs}>`;
    } else {
      console.warn(`⚠️  Warning: Image not found: ${absPath} (resolved to: ${actualPath})`);
      return match; // Keep original if not found
    }
  });
  
  return markdown;
}

function convertLikeC4ViewToImage(markdown, inputFile, rootDir) {
  // Replace <LikeC4View viewId="..." /> with image references
  const likeC4Regex = /<LikeC4View\s+viewId="([^"]+)"\s*\/>/g;

  return markdown.replace(likeC4Regex, (match, viewId) => {
    // Try to find the actual diagram image
    const imagePath = findDiagramImage(viewId, inputFile, rootDir);

    if (imagePath) {
      // Use found image path
      return `![${viewId}](${imagePath})`;
    } else {
      // If not found, use placeholder and warn
      console.warn(`⚠️  Warning: Diagram image not found for viewId "${viewId}"`);
      console.warn(`   Expected locations:`);
      console.warn(`   - generated/diagrams/${viewId}.png`);
      console.warn(`   - astro/likec4-exports/${viewId}.png (legacy)`);
      console.warn(`   - architecture/export/${viewId}.png`);
      console.warn(`   Run: npm run build:diagrams`);
      console.warn(`   Using placeholder - diagram may not appear in PPT\n`);
      return `![${viewId}](./images/${viewId}.png)`;
    }
  });
}

function removeAstroComponents(content) {
  // Remove Astro/MDX-specific components that don't work in Marp/PPT
  // :::note[...] ... ::: blocks
  let filtered = content;

  // Remove :::note blocks (Astro admonitions)
  filtered = filtered.replace(/:::note\[[^\]]*\]\s*\n[\s\S]*?:::/g, '');

  // Remove other ::: blocks (warnings, tips, etc.)
  filtered = filtered.replace(/:::(?:warning|tip|info|danger|caution)\[?[^\]]*\]?\s*\n[\s\S]*?:::/g, '');

  // Remove any remaining ::: blocks
  filtered = filtered.replace(/:::[^\n]*\n[\s\S]*?:::/g, '');

  return filtered;
}

function filterContentByFormat(content, targetFormat) {
  // Handle format-specific content markers
  // <!-- PPT_ONLY --> ... <!-- /PPT_ONLY --> - Only include in PPT
  // <!-- CONFLUENCE_ONLY --> ... <!-- /CONFLUENCE_ONLY --> - Only include in Confluence
  // <!-- GITHUB_ONLY --> ... <!-- /GITHUB_ONLY --> - Only include in GitHub Pages
  // <!-- NOT_PPT --> ... <!-- /NOT_PPT --> - Exclude from PPT (include in Confluence, Astro, etc.)

  let filtered = content;

  if (targetFormat === 'ppt' || targetFormat === 'marp') {
    // Remove CONFLUENCE_ONLY and GITHUB_ONLY blocks (including their newlines)
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Remove NOT_PPT blocks (including their newlines)
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '');
    // Keep PPT_ONLY blocks (remove comment lines entirely, keep content)
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Remove Astro/MDX components
    filtered = removeAstroComponents(filtered);
    // Remove figure captions for PPT (keep them for Confluence)
    // Remove <figcaption> tags and their content, including surrounding whitespace/newlines
    filtered = filtered.replace(/[ \t]*<figcaption>[\s\S]*?<\/figcaption>[ \t]*\r?\n?/gi, '');
  } else if (targetFormat === 'confluence') {
    // Remove PPT_ONLY and GITHUB_ONLY blocks (including their newlines)
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Keep CONFLUENCE_ONLY blocks (remove comment lines entirely, keep content)
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Keep NOT_PPT blocks (remove comment lines entirely, keep content)
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '');
    // Remove Astro/MDX components (or convert to Confluence format if needed)
    filtered = removeAstroComponents(filtered);
  } else if (targetFormat === 'github' || targetFormat === 'astro') {
    // Remove PPT_ONLY and CONFLUENCE_ONLY blocks (including their newlines)
    filtered = filtered.replace(/^[ \t]*<!--\s*PPT_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/PPT_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*CONFLUENCE_ONLY\s*-->[ \t]*\r?\n[\s\S]*?^[ \t]*<!--\s*\/CONFLUENCE_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Keep GITHUB_ONLY blocks (remove comment lines entirely, keep content)
    filtered = filtered.replace(/^[ \t]*<!--\s*GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*\/GITHUB_ONLY\s*-->[ \t]*\r?\n/gm, '');
    // Keep NOT_PPT blocks (remove comment lines entirely, keep content)
    filtered = filtered.replace(/^[ \t]*<!--\s*NOT_PPT\s*-->[ \t]*\r?\n/gm, '');
    filtered = filtered.replace(/^[ \t]*<!--\s*\/NOT_PPT\s*-->[ \t]*\r?\n/gm, '');
    // Keep Astro components for GitHub Pages (they work there)
  }

  return filtered;
}

function getBackgroundImagePath(inputFile, rootDir, imageType = 'title', slideSize = '16:9') {
  // imageType: 'title' (all logos) or 'section' (Defra logo only)
  // slideSize: '16:9' or '4:3' - determines which image version to use
  const is16x9 = slideSize === '16:9';
  const imageName = imageType === 'title'
    ? (is16x9 ? 'defra-title-background-full-16-9.png' : 'defra-title-background-full.png')  // Title slide with all logos
    : (is16x9 ? 'defra-title-background-16-9.png' : 'defra-title-background.png');     // Section/end slide with Defra logo only

  // Try consumer's templates first, then library's bundled templates
  const possiblePaths = [
    join(rootDir, 'templates', imageName),
    join(rootDir, 'templates', 'defra-title-background.png'), // Old fallback name
    join(libraryTemplatesDir, imageName),
    join(libraryTemplatesDir, 'defra-title-background.png'),
  ];

  for (const bgImagePath of possiblePaths) {
    if (existsSync(bgImagePath)) {
      // Calculate relative path from input file to the image
      const inputDir = dirname(inputFile);
      const relativePath = relative(inputDir, bgImagePath);
      return relativePath.replace(/\\/g, '/');
    }
  }

  return null;
}

function convertHeadingsToSlideBreaks(content, inputFile, rootDir, headingLevel = 1) {
  // Convert specified heading level (H1, H2, etc.) to Marp slide breaks (---)
  // Keep the heading but add a slide break before it
  // Add <!-- fit --> directive for slides with lots of content
  // Detect section/end slides and add appropriate background image
  // headingLevel: 1 for H1 (#), 2 for H2 (##), etc. (default: 1)
  const lines = content.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let currentSlideContent = [];
  let slideStartIndex = -1;

  // Create regex pattern for the specified heading level
  // headingLevel 1 = /^#\s+/ (H1)
  // headingLevel 2 = /^##\s+/ (H2)
  // headingLevel 3 = /^###\s+/ (H3)
  const headingHashes = '#'.repeat(headingLevel);
  const headingPattern = new RegExp(`^${headingHashes}\\s+`);

  // Get section background image path (use 16:9 version)
  const sectionBgPath = getBackgroundImagePath(inputFile, rootDir, 'section', '16:9');

  function shouldAddFitDirective(slideLines) {
    // Count lines of content (excluding headings and empty lines)
    const contentLines = slideLines.filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.match(/^#+\s+/) && !trimmed.match(/^---\s*$/);
    });

    // Add fit directive if slide has more than 15 lines of content
    // or contains a table or long list
    const hasTable = slideLines.some(line => line.trim().startsWith('|'));
    const hasLongList = contentLines.length > 12;

    return hasTable || hasLongList || contentLines.length > 15;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code blocks
    if (line.match(/^```/)) {
      inCodeBlock = !inCodeBlock;
      if (inCodeBlock) {
        codeBlockLang = line.substring(3).trim();
      }
      if (slideStartIndex >= 0) {
        currentSlideContent.push(line);
      }
      result.push(line);
      continue;
    }

    // Don't process inside code blocks
    if (inCodeBlock) {
      if (slideStartIndex >= 0) {
        currentSlideContent.push(line);
      }
      result.push(line);
      continue;
    }

    // Check for section slide marker
    const isSectionMarker = line.match(/<!--\s*section-slide\s*-->|<!--\s*end-slide\s*-->/i);

    // Convert specified heading level to slide break + heading
    if (line.match(headingPattern)) {
      // Check if previous slide needs fit directive
      if (slideStartIndex >= 0 && currentSlideContent.length > 0) {
        if (shouldAddFitDirective(currentSlideContent)) {
          // Find the slide break before this slide (go backwards from current position)
          for (let j = result.length - 1; j >= 0; j--) {
            if (result[j] && result[j].match(/^---\s*$/)) {
              // Insert <!-- fit --> after the slide break
              result.splice(j + 1, 0, '', '<!-- fit -->');
              break;
            }
          }
        }
      }

      // Don't add slide break before first heading of specified level
      if (result.length > 0 && !result[result.length - 1].match(/^---\s*$/)) {
        // Add white background directive BEFORE the slide break for content slides
        // Check if this is NOT a section slide (section slides get green background)
        let isSection = false;
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (lines[j].match(/<!--\s*section-slide\s*-->|<!--\s*end-slide\s*-->/i)) {
            isSection = true;
            break;
          }
        }
        if (!isSection) {
          result.push('<!-- _backgroundColor: #ffffff -->');
        }
        result.push('---');
        result.push('');
      }

      // Check if this is a section/end slide (look ahead for marker in next few lines)
      let isSection = false;
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (lines[j].match(/<!--\s*section-slide\s*-->|<!--\s*end-slide\s*-->/i)) {
          isSection = true;
          break;
        }
      }

      // Start tracking new slide
      slideStartIndex = result.length;
      currentSlideContent = [line];
      result.push(line);

      // Add section background image if this is a section slide
      if (isSection && sectionBgPath) {
        // Add a class marker before the slide break to mark this as a sub-section slide
        // Find the most recent slide break and add the class
        for (let j = result.length - 1; j >= 0; j--) {
          if (result[j] && result[j].match(/^---\s*$/)) {
            result.splice(j, 0, '<!-- _class: section-slide -->');
            result.splice(j + 1, 0, '<!-- _backgroundColor: #00af40 -->');
            break;
          }
        }
        result.push('');
        result.push(`![bg](${sectionBgPath})`);
      }
    } else if (isSectionMarker) {
      // Section marker on its own line - add class and background to the most recent slide break
      // Find the most recent slide break
      for (let j = result.length - 1; j >= 0; j--) {
        if (result[j] && result[j].match(/^---\s*$/)) {
          // Add section-slide class and green background before the slide break
          if (!result[j - 1] || !result[j - 1].includes('section-slide')) {
            result.splice(j, 0, '<!-- _class: section-slide -->');
            result.splice(j + 1, 0, '<!-- _backgroundColor: #00af40 -->');
          }
          // Add section background after the slide break if not already present
          const hasBg = result.slice(j + 1, j + 5).some(l => l && l.includes('![bg]'));
          if (sectionBgPath && !hasBg) {
            result.splice(j + 3, 0, '', `![bg](${sectionBgPath})`);
          }
          break;
        }
      }
      // Don't include the marker in output (it's just a directive)
    } else {
      if (slideStartIndex >= 0) {
        currentSlideContent.push(line);
      }
      result.push(line);
    }
  }

  // Check last slide
  if (slideStartIndex >= 0 && currentSlideContent.length > 0) {
    if (shouldAddFitDirective(currentSlideContent)) {
      // Find the slide break before this slide
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i] && result[i].match(/^---\s*$/)) {
          result.splice(i + 1, 0, '', '<!-- fit -->');
          break;
        }
      }
    }

    // Check if last slide should have section background (end slide)
    // Look for end slide marker in the last slide content
    const hasEndMarker = currentSlideContent.some(l => l.match(/<!--\s*end-slide\s*-->/i));
    if (hasEndMarker && sectionBgPath) {
      // Find the last slide break and add section-slide class and background
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i] && result[i].match(/^---\s*$/)) {
          // Add section-slide class and green background before the slide break
          if (!result[i - 1] || !result[i - 1].includes('section-slide')) {
            result.splice(i, 0, '<!-- _class: section-slide -->');
            result.splice(i + 1, 0, '<!-- _backgroundColor: #00af40 -->');
          }
          const hasBg = result.slice(i + 1).some(l => l && l.includes('![bg]'));
          if (!hasBg) {
            result.splice(i + 3, 0, '', `![bg](${sectionBgPath})`);
          }
          break;
        }
      }
    }
  }

  return result.join('\n');
}

// Get library templates directory (bundled with the package)
const libraryTemplatesDir = join(__dirname, '..', '..', 'templates');

function loadExternalCSS(cssPath, rootDir) {
  // Try to load external CSS file if it exists
  // Priority: consumer's templates > library's bundled templates
  const possiblePaths = [
    join(rootDir, 'templates', 'defra-marp-theme.css'),
    join(rootDir, 'templates', cssPath),
    cssPath,
    // Fallback to library's bundled templates
    join(libraryTemplatesDir, 'defra-marp-theme.css'),
    join(libraryTemplatesDir, cssPath),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      try {
        const css = readFileSync(path, 'utf-8');
        return css;
      } catch (error) {
        // Ignore read errors
      }
    }
  }

  return null;
}

function createMarpFrontmatter(options, frontmatter, rootDir, inputFile) {
  const {
    theme = 'defra',
    title,
    author,
    date,
    version,
    cssFile = 'defra-marp-theme.css'
  } = options;

  // Use frontmatter values if not provided via CLI
  const finalTitle = title || frontmatter.title || 'Solution Overview';
  const finalAuthor = author || frontmatter.author || '';
  const finalDate = date || frontmatter.date || new Date().toLocaleDateString('en-GB');
  const finalVersion = version || frontmatter.version || '';

  // Try to load external CSS
  const externalCSS = loadExternalCSS(cssFile, rootDir);

  // Get background image path for title slide (all logos)
  // Use 16:9 images since we're using size: 16:9
  const bgImagePath = getBackgroundImagePath(inputFile, rootDir, 'title', '16:9');
  const bgImageTag = bgImagePath ? `![bg](${bgImagePath})` : '';

  return `---
marp: true
theme: defra
_class: lead
paginate: true
size: 16:9
---

<!-- _backgroundSize: contain -->

<!--
footer: '<span class="sensitivity">Official Sensitive</span><span class="footer-summary">${finalTitle}</span>'
-->

${externalCSS ? `<style>\n${externalCSS}\n</style>\n\n` : ''}
<style>
/* Diagram/image scaling and centering */
img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  display: block;
  margin-left: auto;
  margin-right: auto;
}

</style>

<!-- _class: title-slide -->
<!-- _backgroundSize: contain -->
<!-- _backgroundPosition: center -->
<!-- _backgroundColor: #00af40 -->

<h1 class="title-page-main">${finalTitle}</h1>

${finalVersion ? `<p class="title-page-sub">Version ${finalVersion}</p>` : ''}
${finalAuthor ? `<p class="title-page-sub">${finalAuthor}</p>` : ''}
${finalDate ? `<p class="title-page-sub">${finalDate}</p>` : ''}

${bgImageTag}

---

`;
}

function convertToMarp(inputFile, options, rootDir) {
  const inputPath = resolve(inputFile);

  if (!existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  // Read input file
  const inputContent = readFileSync(inputPath, 'utf-8');

  // Extract existing frontmatter
  const { frontmatter, content } = extractFrontmatter(inputContent);

  // Convert content
  let marpContent = content;

  // Filter content for PPT format (include PPT_ONLY, exclude others)
  marpContent = filterContentByFormat(marpContent, 'ppt');

  // Convert absolute /docs/... image paths to relative paths
  marpContent = convertAbsoluteImagePaths(marpContent, inputPath, rootDir);

  // Convert LikeC4View components to images
  marpContent = convertLikeC4ViewToImage(marpContent, inputPath, rootDir);

  // Convert specified heading level to slide breaks
  marpContent = convertHeadingsToSlideBreaks(marpContent, inputPath, rootDir, options.headingLevel || 1);

  // Create Marp frontmatter
  const marpFrontmatter = createMarpFrontmatter(options, frontmatter, rootDir, inputPath);

  // Combine
  const finalContent = marpFrontmatter + marpContent;

  // Determine output path
  let outputPath;
  const inputName = basename(inputPath, extname(inputPath));
  const inputDir = dirname(inputPath);
  outputPath = join(inputDir, `${inputName}.marp.md`);

  // Create output directory if needed
  mkdirSync(dirname(outputPath), { recursive: true });

  // Write output
  writeFileSync(outputPath, finalContent, 'utf-8');

  return outputPath;
}

// ====================
// Marp to PPTX Conversion Functions
// ====================

function checkMarp() {
  try {
    execSync('marp --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    // Try npx version
    try {
      execSync('npx @marp-team/marp-cli --version', { stdio: 'pipe' });
      return 'npx';
    } catch (e) {
      return false;
    }
  }
}

function convertMarpToPptx(marpFile, outputFile, theme, rootDir, editable = false) {
  const inputPath = resolve(marpFile);

  if (!existsSync(inputPath)) {
    console.error(`Error: Marp file not found: ${inputPath}`);
    process.exit(1);
  }

  // Determine output path
  if (!outputFile) {
    const inputName = basename(inputPath, extname(inputPath));
    // Remove .marp suffix if present
    const cleanName = inputName.replace(/\.marp$/, '');
    outputFile = join(rootDir, 'generated', 'pptx', cleanName + '.pptx');
  } else {
    outputFile = resolve(outputFile);
  }

  // Create output directory if needed
  mkdirSync(dirname(outputFile), { recursive: true });

  // Check Marp availability
  const marpAvailable = checkMarp();
  if (!marpAvailable) {
    console.error('Error: Marp CLI is not installed.');
    console.error('\nInstall Marp CLI:');
    console.error('  npm install -g @marp-team/marp-cli');
    console.error('\nOr use npx (no installation needed):');
    console.error('  npx @marp-team/marp-cli <input.md> --pptx -o <output.pptx>');
    process.exit(1);
  }

  // Build Marp command
  const marpCommand = marpAvailable === 'npx'
    ? 'npx @marp-team/marp-cli'
    : 'marp';

  const marpArgs = [
    `"${inputPath}"`,
    '--pptx',
    '--allow-local-files',  // Allow local file access (images, etc.)
    '-o', `"${outputFile}"`,
  ];

  if (editable) {
    marpArgs.push('--pptx-editable');
    console.log('⚠️  Using editable PPTX mode (experimental)');
    console.log('   Note: Requires LibreOffice Impress installed');
    console.log('   Some complex layouts may not render correctly\n');
  }

  if (theme) {
    marpArgs.push('--theme', theme);
  }

  const command = `${marpCommand} ${marpArgs.join(' ')}`;

  console.log(`Converting Marp to PPTX: ${inputPath}`);
  console.log(`Output: ${outputFile}\n`);

  try {
    execSync(command, { stdio: 'inherit', shell: true });
    console.log(`\n✓ Successfully generated: ${outputFile}`);
    return outputFile;
  } catch (error) {
    console.error(`\n✗ Failed to convert: ${error.message}`);
    process.exit(1);
  }
}

// ====================
// Main Function
// ====================

function convertMdToPptxViaMarp(inputFile, options) {
  const rootDir = process.cwd();
  const inputPath = resolve(inputFile);

  // Step 1: Convert markdown to Marp format
  console.log('Step 1: Converting markdown to Marp format...\n');
  const marpFile = convertToMarp(inputPath, options, rootDir);
  console.log(`✓ Converted to Marp format: ${marpFile}\n`);

  // Step 2: Convert Marp to PPTX
  console.log('Step 2: Converting Marp to PPTX...\n');
  let pptxOutput = convertMarpToPptx(marpFile, options.outputFile, options.theme, rootDir, options.editable);

  // Step 3: Apply template if requested
  if (options.applyTemplate) {
    console.log('\nStep 3: Applying Defra template...\n');
    const applyTemplateScript = join(rootDir, 'scripts', 'ppt', 'apply-pptx-template.js');
    const finalOutput = pptxOutput.replace(/\.pptx$/, '-styled.pptx');

    try {
      execSync(`node "${applyTemplateScript}" "${pptxOutput}" --template "${options.templateFile || ''}" --output "${finalOutput}"`, {
        stdio: 'inherit',
        cwd: rootDir,
        shell: true
      });
      console.log(`\n✓ Final styled PPTX: ${finalOutput}`);
      pptxOutput = finalOutput;
    } catch (error) {
      console.warn('\n⚠️  Template application failed, but base PPTX was generated successfully');
      console.warn('   You can manually apply the template in PowerPoint if needed.');
    }
  }

  // Step 4: Clean up intermediate Marp file (unless --keep-marp)
  if (!options.keepMarp) {
    try {
      unlinkSync(marpFile);
      console.log(`\n✓ Cleaned up intermediate file: ${marpFile}`);
    } catch (error) {
      // Ignore cleanup errors
    }
  } else {
    console.log(`\n✓ Kept intermediate Marp file: ${marpFile}`);
  }

  console.log(`\n✓ Successfully generated PPTX: ${pptxOutput}`);
}

// ====================
// Main Execution
// ====================

const options = parseArgs();

if (!options.inputFile) {
  console.error('Usage: node scripts/ppt/md-to-pptx-marp.js <input.md> [options]');
  console.error('\nOptions:');
  console.error('  --output, -o         Output PPTX file path (default: generated/pptx/<input-name>.pptx)');
  console.error('  --theme              Marp theme name (default: defra)');
  console.error('  --title              Presentation title');
  console.error('  --author             Author name');
  console.error('  --date               Date (default: current date)');
  console.error('  --version            Version number');
  console.error('  --heading-level      Heading level for slide breaks (1-6, default: 1 for H1)');
  console.error('  --keep-marp          Keep intermediate .marp.md file');
  console.error('  --editable           Generate editable PPTX (experimental, requires LibreOffice Impress)');
  console.error('                       Note: Text will be editable in Google Slides/PowerPoint, but some layouts may break');
  console.error('  --apply-template     Apply Defra template to generated PPTX (requires python-pptx)');
  console.error('  --template, -t       Path to template file (default: templates/defra-template.pptx)');
  console.error('\nExample:');
  console.error('  node scripts/ppt/md-to-pptx-marp.js docs/system-context.md --title "System Overview"');
  console.error('  node scripts/ppt/md-to-pptx-marp.js docs/system-context.md --apply-template');
  process.exit(1);
}

convertMdToPptxViaMarp(options.inputFile, options);
