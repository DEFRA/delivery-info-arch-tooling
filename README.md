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
publish-to-confluence --config confluence-config.json

# Publish only a specific space
publish-to-confluence --config confluence-config.json --space BTMS
```

### Generating PowerPoint

```bash
generate-pptx docs/overview.md --title "System Overview"
```

### Exporting PDF

```bash
export-pdf docs/analysis.md
```

### Exporting Diagrams

```bash
export-diagrams --source architecture --output generated/diagrams
```

## Programmatic Usage

```javascript
const tooling = require('@defra/delivery-info-arch-tooling');

// Publish to Confluence
await tooling.confluence.publish({
  configPath: 'confluence-config.json',
  auth: {
    username: process.env.CONFLUENCE_USERNAME,
    apiToken: process.env.CONFLUENCE_API_TOKEN
  }
});

// Generate PowerPoint
await tooling.ppt.generate({
  inputFile: 'docs/overview.md',
  title: 'System Overview',
  headingLevel: 1
});

// Export PDF
await tooling.pdf.export({
  inputFile: 'docs/analysis.md',
  outputDir: 'generated/pdf'
});

// Export diagrams
await tooling.diagrams.exportLikeC4Diagrams({
  sourceDir: 'architecture',
  outputDir: 'generated/diagrams',
  format: 'png'
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
      "description": "BTMS documentation"
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

### generate-pptx

```
Usage: generate-pptx <input.md> [OPTIONS]

Options:
  --output, -o FILE              Output PPTX file path
  --title                        Presentation title
  --author                       Author name
  --heading-level                Heading level for slide breaks (1-6)
  --keep-marp                    Keep intermediate .marp.md file
```

### export-pdf

```
Usage: export-pdf [FILES...]

If no files specified, exports all markdown files matching default patterns.
```

### export-diagrams

```
Usage: export-diagrams [OPTIONS]

Options:
  --source, -s DIR               Source directory with .c4 files
  --output, -o DIR               Output directory for images
  --format, -f FORMAT            Output format: png or svg
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
- **Image handling**: Uploads and embeds LikeC4 and Mermaid diagrams
- **Warning panels**: Auto-adds "generated from source" warnings
- **Table of contents**: Auto-generates TOC for pages with many headings
- **Space filtering**: Publish to specific spaces
- **Generated page protection**: Only updates pages with "generated" label

### PowerPoint Generation

- **Marp-based**: Uses Marp CLI for high-quality conversions
- **Heading-based slides**: Configure which heading level triggers new slides
- **Theme support**: Customizable themes and styling
- **Diagram embedding**: Converts LikeC4View components to images

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
- For PPT generation: Marp CLI (`npm install -g @marp-team/marp-cli`)
- For diagrams: LikeC4 (`npm install likec4`)
- For Mermaid: `@mermaid-js/mermaid-cli`

## License

[Open Government Licence v3.0](http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)

