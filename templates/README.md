# Defra PowerPoint Templates

This directory contains Defra branding assets for PowerPoint generation via Marp.

## Files

### Theme and Styling

- **`defra-marp-theme.css`** - Marp theme CSS with Defra colours, fonts, and styling
- **`defra-template.pptx`** - Reference Defra PowerPoint template

### Background Images

- **`defra-title-background-full-16-9.png`** - Title slide background (16:9) with all agency logos
- **`defra-title-background-16-9.png`** - Section slide background (16:9) with Defra logo only

## Usage

These templates are automatically used by `generate-pptx`. No configuration needed:

```bash
generate-pptx docs/overview.md --title "System Overview"
```

## Customising

To customise the templates for your project, copy this directory:

```bash
cp -r node_modules/@defra/delivery-info-arch-tooling/templates ./templates
```

Then edit the files in your local `templates/` directory. The generator will use your local templates instead of the bundled ones.

### Colours

Edit `defra-marp-theme.css` to change colours:

```css
/* Defra green for headers and accents */
h1, h2, h3 { color: rgb(0, 176, 80); }

/* Green background for title slides */
section:first-of-type { background-color: #00af40; }
```

### Tables

```css
th {
  background-color: rgb(0, 175, 65);
  color: white;
}
```

## Background Images

| Image | Purpose | Dimensions |
|-------|---------|------------|
| `defra-title-background-full-16-9.png` | Title slide (all agency logos) | 1920x1080 |
| `defra-title-background-16-9.png` | Section/end slides (Defra logo only) | 1920x1080 |
| `defra-title-background-full.png` | Title slide (4:3 legacy) | 1024x768 |
| `defra-title-background.png` | Section slides (4:3 legacy) | 1024x768 |
