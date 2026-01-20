# @defra/delivery-info-arch-tooling

Shared tooling for generating documentation (Confluence, PPT, PDF) across Defra verticals.

## Installation

```bash
npm install @defra/delivery-info-arch-tooling
```

Or install from GitHub:

```bash
npm install github:DEFRA/delivery-info-arch-tooling
```

## Quick Start

### Publishing to Confluence

```bash
# Set credentials as environment variables
export CONFLUENCE_USERNAME="your-email@defra.gov.uk"
export CONFLUENCE_API_TOKEN="your-api-token"

# Publish all configured content
npm run publish:confluence

# Publish only a specific space
npm run publish:confluence:space BTMS
```

### Generating PowerPoint

```bash
npm run pptx:build "docs/overview.md" -- --title "System Overview"
```

### Exporting PDF

```bash
npm run export:pdf docs/analysis.md
```

### Exporting Diagrams

```bash
npm run build:diagrams
```

## Programmatic Usage

```javascript
const tooling = require('@defra/delivery-info-arch-tooling');

// Publish to Confluence
await tooling.confluence.publish({
  configPath: 'confluence-config.json',  // Required
  spaceFilter: 'BTMS',  // Optional: filter to specific space
  parentPageId: '123456',  // Optional: parent page ID
  auth: {
    username: process.env.CONFLUENCE_USERNAME,  // Required
    apiToken: process.env.CONFLUENCE_API_TOKEN  // Required
  },
  contentRoot: 'docs',  // Optional: content root directory
  confluenceUrl: 'https://eaflood.atlassian.net'  // Optional: defaults to env var or this URL
});

// Generate PowerPoint
await tooling.ppt.generate({
  inputFile: 'docs/overview.md',
  title: 'System Overview',  // Optional
  author: 'Author Name',  // Optional
  theme: 'defra',  // Optional, defaults to 'defra'
  headingLevel: 1,  // Optional, defaults to 1
  outputFile: 'output.pptx',  // Optional
  keepMarp: false  // Optional, keep intermediate .marp.md file
});

// Export PDF
await tooling.pdf.export({
  inputFile: 'docs/analysis.md',
  outputDir: 'generated/pdf',  // Optional, defaults to 'generated/pdf'
  cssPath: 'custom.css'  // Optional custom CSS
});

// Export LikeC4 diagrams
await tooling.diagrams.exportLikeC4Diagrams({
  sourceDir: 'architecture',  // Optional, defaults to 'architecture'
  outputDir: 'generated/diagrams',  // Optional, defaults to 'generated/diagrams'
  format: 'png'  // Optional, 'png' or 'svg', defaults to 'png'
});

// Convert LikeC4 to Mermaid
await tooling.diagrams.convertLikeC4ToMermaid({
  sourceDir: 'architecture/current/btms',
  outputDir: 'architecture/current/btms/mmd'
});

// Render Mermaid diagrams
await tooling.diagrams.renderMermaidDiagrams({
  outputDir: 'build/mmd',  // Optional, defaults to 'build/mmd'
  format: 'svg',  // Optional, 'svg' or 'png', defaults to 'svg'
  width: 1800  // Optional, PNG width, defaults to 1800
});
```

## Configuration

### confluence-config.json

```json
{
  "spaceMapping": {
    "BTMS": "BTMS",
    "Trade": "TIDIA"
  },
  "publishPaths": [
    {
      "path": "systems/BTMS/**/*.md",
      "type": "markdown",
      "description": "BTMS documentation",
      "exclude": [
        "README.md",
        "_*.md"
      ]
    }
  ],
  "parentPageId": "",
  "excludePatterns": [
    "README.md",
    "_*.md"
  ]
}
```

See `examples/config-examples/` for complete examples.

## CLI Commands

The tooling provides CLI commands that can be used directly or via npm scripts. Projects typically wrap these in npm scripts (see examples above).

### publish-to-confluence

```
Usage: publish-to-confluence [OPTIONS]

Options:
  --space, -s SPACE_KEY          Filter: only publish files for this space
  --parent-page-id, -p PAGE_ID   Parent page ID
  --username, -u USERNAME        Confluence username/email
  --api-token, -t TOKEN          Confluence API token
  --config, -c PATH              Path to confluence-config.json
  --help, -h                     Show help
```

**Example npm scripts** (typically added to your project's `package.json`):
```json
{
  "scripts": {
    "publish:confluence": "publish-to-confluence --config scripts/confluence/confluence-config.json",
    "publish:confluence:space": "publish-to-confluence --config scripts/confluence/confluence-config.json --space"
  }
}
```

### generate-pptx

```
Usage: generate-pptx <input.md> [OPTIONS]

Options:
  --output, -o FILE              Output PPTX file path (default: generated/pptx/<input-name>.pptx)
  --theme                        Marp theme name (default: defra)
  --title                        Presentation title
  --author                       Author name
  --date                         Date (default: current date)
  --version                      Version number
  --heading-level                Heading level for slide breaks (1-6, default: 1)
  --keep-marp                    Keep intermediate .marp.md file
  --editable                     Generate editable PPTX (experimental, requires LibreOffice Impress)
  --apply-template               Apply Defra template to generated PPTX (requires python-pptx)
  --template, -t                 Path to template file (default: templates/defra-template.pptx)
```

**Example npm script**:
```json
{
  "scripts": {
    "pptx:build": "generate-pptx"
  }
}
```

Usage: `npm run pptx:build "docs/file.md" -- --title "Title" --editable`

### export-pdf

```
Usage: export-pdf [FILES...]

If no files specified, exports all markdown files matching default patterns.
```

**Example npm script**:
```json
{
  "scripts": {
    "export:pdf": "export-pdf"
  }
}
```

### export-diagrams

```
Usage: export-diagrams [OPTIONS]

Options:
  --source, -s DIR               Source directory with .c4 files
  --output, -o DIR               Output directory for images
  --format, -f FORMAT            Output format: png or svg
```

**Example npm script**:
```json
{
  "scripts": {
    "build:diagrams": "export-diagrams"
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONFLUENCE_URL` | Confluence instance URL | `https://eaflood.atlassian.net` |
| `CONFLUENCE_USERNAME` | Confluence username/email | Required |
| `CONFLUENCE_API_TOKEN` | Confluence API token | Required |
| `CONFLUENCE_SPACE` | Default Confluence space | - |
| `PARENT_PAGE_ID` | Default parent page ID | - |
| `GENERATED_LABEL` | Label for generated pages | `generated` |

## Features

### Confluence Publishing

- **Markdown to ADF**: Converts markdown to Confluence's Atlas Document Format
- **Hierarchy preservation**: Creates folder pages to preserve directory structure
- **Image handling**: Uploads and embeds LikeC4, Mermaid, and manual diagrams
- **Warning panels**: Auto-adds "generated from source" warnings
- **Table of contents**: Auto-generates TOC for pages with many headings
- **Space filtering**: Publish to specific spaces via `--space` option
- **Generated page protection**: Only updates pages with "generated" label
- **Conditional content**: Supports PPT_ONLY, NOT_PPT, CONFLUENCE_ONLY, GITHUB_ONLY tags
- **Automatic diagram generation**: Exports missing LikeC4 diagrams automatically

### PowerPoint Generation

- **Marp-based**: Uses Marp CLI for high-quality conversions
- **Defra branding**: Bundled Defra templates and styling
- **Heading-based slides**: Configure which heading level triggers new slides (default: H1)
- **Theme support**: Customizable themes and styling
- **Diagram embedding**: Converts LikeC4View components to images
- **Conditional content**: Supports PPT_ONLY, NOT_PPT, CONFLUENCE_ONLY tags
- **Editable PPTX**: Optional editable output (experimental, requires LibreOffice Impress)
- **Image path conversion**: Automatically converts absolute paths for PPT compatibility

### Bundled Templates

The library includes Defra-branded templates for PowerPoint generation:

```
templates/
├── defra-marp-theme.css              # Marp CSS theme
├── defra-template.pptx               # Reference PowerPoint template
├── defra-title-background-16-9.png   # Section slide background
├── defra-title-background-full-16-9.png  # Title slide background
```

**Template Priority**: The generator looks for templates in this order:
1. Your project's `templates/` directory (allows customisation)
2. Library's bundled `templates/` (Defra defaults)

To customise, copy templates to your project:
```bash
cp -r node_modules/@defra/delivery-info-arch-tooling/templates ./templates
```

### PDF Export

- **Styled output**: Configurable CSS styling
- **Batch processing**: Export multiple files at once
- **Directory preservation**: Maintains folder structure in output

### Diagram Processing

- **LikeC4 export**: Export LikeC4 models to PNG/SVG
- **Mermaid rendering**: Render .mmd files to images
- **LikeC4 to Mermaid**: Convert dynamic views to sequence diagrams

## Requirements

- Node.js 18+
- For PPT generation: Marp CLI (automatically uses `npx @marp-team/marp-cli` if not globally installed)
- For editable PPTX: LibreOffice Impress (required for `--editable` flag)
- For diagrams: LikeC4 (`npm install likec4` as peer dependency)
- For Mermaid: `@mermaid-js/mermaid-cli` (bundled in tooling package)

## License

[Open Government Licence v3.0](http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)

