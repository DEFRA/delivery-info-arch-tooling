#!/usr/bin/env node
/**
 * Convert LikeC4 dynamic views (sequence diagrams) to Mermaid sequence diagrams
 * 
 * This script parses LikeC4 .c4 files and extracts dynamic view definitions,
 * converting them to Mermaid sequence diagram format (.mmd files).
 * 
 * This avoids duplication by using LikeC4 as the single source of truth.
 */

const fs = require('fs').promises;
const path = require('path');
const { readdirSync, statSync } = require('fs');

/**
 * Parse a LikeC4 dynamic view and convert to Mermaid sequence diagram
 */
function parseDynamicViewToMermaid(viewName, viewContent) {
  // Extract sequence steps from the dynamic view
  // Format: "actor -> target "message" "protocol""
  const stepRegex = /^\s*([\w.]+)\s*->\s*([\w.]+)\s*"([^"]*)"(?:\s*"([^"]*)")?/gm;
  const steps = [];
  let match;
  
  while ((match = stepRegex.exec(viewContent)) !== null) {
    const [, source, target, message, protocol] = match;
    steps.push({
      source: source.trim(),
      target: target.trim(),
      message: message.trim(),
      protocol: protocol ? protocol.trim() : null
    });
  }
  
  if (steps.length === 0) {
    return null; // No sequence steps found
  }
  
  // Build Mermaid sequence diagram
  let mermaid = 'sequenceDiagram\n';
  
  // Get unique participants
  const participants = new Set();
  steps.forEach(step => {
    participants.add(step.source);
    participants.add(step.target);
  });
  
  // Add participants (use shorter names for readability)
  const participantMap = new Map();
  let participantIndex = 0;
  participants.forEach(participant => {
    // Use last part of dotted name as display name
    const displayName = participant.split('.').pop();
    const alias = `P${participantIndex++}`;
    participantMap.set(participant, { alias, displayName });
    mermaid += `    participant ${alias} as ${displayName}\n`;
  });
  
  mermaid += '\n';
  
  // Add sequence steps
  steps.forEach(step => {
    const source = participantMap.get(step.source);
    const target = participantMap.get(step.target);
    const message = step.message;
    const protocol = step.protocol;
    
    if (source && target) {
      const messageText = protocol ? `${message} (${protocol})` : message;
      mermaid += `    ${source.alias}->>${target.alias}: ${messageText}\n`;
    }
  });
  
  return mermaid;
}

/**
 * Parse a LikeC4 .c4 file and extract dynamic views
 */
async function parseLikeC4File(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const views = new Map();
  
  // Find dynamic view definitions
  // Format: "dynamic view viewName { ... }"
  const dynamicViewRegex = /dynamic\s+view\s+(\w+)\s*\{([^}]+)\}/gs;
  let match;
  
  while ((match = dynamicViewRegex.exec(content)) !== null) {
    const [, viewName, viewBody] = match;
    const mermaid = parseDynamicViewToMermaid(viewName, viewBody);
    if (mermaid) {
      views.set(viewName, mermaid);
    }
  }
  
  return views;
}

/**
 * Recursively find all .c4 files in a directory
 */
function findC4Files(dir, fileList = []) {
  const files = readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules, hidden directories, and build directory
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'build') {
        findC4Files(filePath, fileList);
      }
    } else if (file.endsWith('.c4')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Convert LikeC4 dynamic views to Mermaid files
 */
async function convertLikeC4ToMermaid(sourceDir, outputDir) {
  const c4Files = findC4Files(sourceDir);
  
  if (c4Files.length === 0) {
    console.log('No .c4 files found');
    return;
  }
  
  console.log(`Found ${c4Files.length} .c4 file(s)\n`);
  
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  let totalViews = 0;
  
  for (const c4File of c4Files) {
    console.log(`Processing: ${path.relative(process.cwd(), c4File)}`);
    
    try {
      const views = await parseLikeC4File(c4File);
      
      for (const [viewName, mermaid] of views.entries()) {
        // Output directly to the output directory (flattened structure)
        await fs.mkdir(outputDir, { recursive: true });
        
        const outputFile = path.join(outputDir, `${viewName}.mmd`);
        await fs.writeFile(outputFile, mermaid, 'utf-8');
        
        console.log(`  ✓ Generated: ${path.relative(process.cwd(), outputFile)}`);
        totalViews++;
      }
    } catch (error) {
      console.error(`  ✗ Error processing ${c4File}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Generated ${totalViews} Mermaid sequence diagram(s) from LikeC4 dynamic views`);
  console.log(`   Output directory: ${outputDir}`);
}

// Main execution
const sourceDir = process.argv[2] || 'architecture/current/btms';
const outputDir = process.argv[3] || 'architecture/current/btms/mmd';

convertLikeC4ToMermaid(sourceDir, outputDir).catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});

