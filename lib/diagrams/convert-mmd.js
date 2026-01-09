#!/usr/bin/env node

const { execSync } = require('child_process');
const { readdirSync, statSync, rmSync, mkdirSync, lstatSync, existsSync } = require('fs');
const { join, relative, dirname } = require('path');

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

const OUTPUT_DIR = 'build/mmd';

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
      // Skip node_modules, hidden directories, and build directory
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'build') {
        findMmdFiles(filePath, fileList);
      }
    } else if (file.endsWith('.mmd')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Convert a single .mmd file to .svg in the output directory
 */
function convertMmdToSvg(mmdFile, rootDir, mmdcPath) {
  // Preserve directory structure in output
  const relativePath = relative(rootDir, mmdFile);
  const svgFile = join(rootDir, OUTPUT_DIR, relativePath.replace(/\.mmd$/, '.svg'));

  // Create output directory if needed
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

// Main execution
const rootDir = process.cwd();

// Find mmdc executable
const mmdcPath = findMmdc();
console.log(`Using mmdc: ${mmdcPath}`);

// Clean output directory
console.log(`Cleaning ${OUTPUT_DIR}...`);
rmSync(join(rootDir, OUTPUT_DIR), { recursive: true, force: true });

const mmdFiles = findMmdFiles(rootDir);

if (mmdFiles.length === 0) {
  console.log('No .mmd files found');
  process.exit(0);
}

console.log(`Found ${mmdFiles.length} .mmd file(s)\n`);

mmdFiles.forEach(file => convertMmdToSvg(file, rootDir, mmdcPath));

console.log(`\nConversion complete! SVG files are in ${OUTPUT_DIR}/`);