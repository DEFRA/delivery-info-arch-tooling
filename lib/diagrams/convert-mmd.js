#!/usr/bin/env node

const { execSync } = require('child_process');
const { readdirSync, statSync, rmSync, mkdirSync, lstatSync, existsSync } = require('fs');
const { join, relative, dirname, basename } = require('path');

/**
 * Find the mmdc executable
 * Searches in: library's node_modules, consumer's node_modules, global npx
 */
function findMmdc() {
  // Check library's own node_modules (when used as dependency)
  const libMmdc = join(__dirname, '..', '..', 'node_modules', '.bin', 'mmdc');
  if (existsSync(libMmdc)) {
    return libMmdc;
  }

  // Check consumer's node_modules
  const consumerMmdc = join(process.cwd(), 'node_modules', '.bin', 'mmdc');
  if (existsSync(consumerMmdc)) {
    return consumerMmdc;
  }

  // Fall back to npx (will download if needed)
  return 'npx mmdc';
}

// Output directories and formats
const SVG_OUTPUT_DIR = 'build/mmd';
const PNG_OUTPUT_DIR = 'generated/diagrams';

/**
 * Recursively find all .mmd files in a directory
 */
function findMmdFiles(dir, fileList = []) {
  const files = readdirSync(dir);

  files.forEach(file => {
    const filePath = join(dir, file);

    // Use lstatSync first to check if it's a symlink
    let stat;
    try {
      const lstat = lstatSync(filePath);
      // Skip symlinks (they may be broken)
      if (lstat.isSymbolicLink()) {
        return;
      }
      stat = statSync(filePath);
    } catch (error) {
      // Skip files/directories that can't be accessed
      console.warn(`Warning: Skipping inaccessible path: ${filePath}`);
      return;
    }

    if (stat.isDirectory()) {
      // Skip node_modules, hidden directories, build and generated directories
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'build' && file !== 'generated') {
        findMmdFiles(filePath, fileList);
      }
    } else if (file.endsWith('.mmd')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Convert a single .mmd file to SVG (preserving directory structure in build/mmd)
 */
function convertMmdToSvg(mmdFile, rootDir, mmdcPath) {
  const relativePath = relative(rootDir, mmdFile);
  const svgFile = join(rootDir, SVG_OUTPUT_DIR, relativePath.replace(/\.mmd$/, '.svg'));

  mkdirSync(dirname(svgFile), { recursive: true });

  console.log(`Converting ${relativePath} -> ${relative(rootDir, svgFile)}`);

  try {
    execSync(
      `"${mmdcPath}" -i "${mmdFile}" -o "${svgFile}" -b white`,
      { stdio: 'inherit', shell: true }
    );
  } catch (error) {
    console.error(`Failed to convert ${mmdFile}:`, error.message);
    process.exit(1);
  }
}

/**
 * Convert a single .mmd file to PNG (flat structure in generated/diagrams for site serving)
 * Uses scale factor of 3 for high-resolution, readable output
 */
function convertMmdToPng(mmdFile, rootDir, mmdcPath) {
  const baseName = basename(mmdFile, '.mmd');
  const pngFile = join(rootDir, PNG_OUTPUT_DIR, `${baseName}.png`);

  mkdirSync(dirname(pngFile), { recursive: true });

  console.log(`Converting ${basename(mmdFile)} -> ${relative(rootDir, pngFile)}`);

  try {
    execSync(
      `"${mmdcPath}" -i "${mmdFile}" -o "${pngFile}" -b white -s 3`,
      { stdio: 'inherit', shell: true }
    );
  } catch (error) {
    console.error(`Failed to convert ${mmdFile} to PNG:`, error.message);
    process.exit(1);
  }
}

// Main execution
const rootDir = process.cwd();

// Find mmdc executable
const mmdcPath = findMmdc();
console.log(`Using mmdc: ${mmdcPath}`);

// Clean SVG output directory
console.log(`Cleaning ${SVG_OUTPUT_DIR}...`);
rmSync(join(rootDir, SVG_OUTPUT_DIR), { recursive: true, force: true });

// Ensure PNG output directory exists (don't clean - may contain LikeC4 exports)
mkdirSync(join(rootDir, PNG_OUTPUT_DIR), { recursive: true });

const mmdFiles = findMmdFiles(rootDir);

if (mmdFiles.length === 0) {
  console.log('No .mmd files found');
  process.exit(0);
}

console.log(`Found ${mmdFiles.length} .mmd file(s)\n`);

// Convert to both SVG (for legacy/other uses) and PNG (for site serving)
console.log('--- Converting to SVG (build/mmd) ---');
mmdFiles.forEach(file => convertMmdToSvg(file, rootDir, mmdcPath));

console.log('\n--- Converting to PNG (generated/diagrams) ---');
mmdFiles.forEach(file => convertMmdToPng(file, rootDir, mmdcPath));

console.log(`\nConversion complete!`);
console.log(`  SVG files: ${SVG_OUTPUT_DIR}/`);
console.log(`  PNG files: ${PNG_OUTPUT_DIR}/`);