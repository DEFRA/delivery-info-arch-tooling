#!/usr/bin/env node
/**
 * Convert Markdown to Confluence Atlas Doc Format (Cloud Editor Format)
 * 
 * This converter transforms markdown content into Confluence's native
 * atlas_doc_format JSON structure, which is compatible with the cloud editor
 * and eliminates the legacy editor warning.
 */

const readline = require('readline');

/**
 * Create a text node with optional marks (formatting)
 */
function createTextNode(text, marks = []) {
    const node = {
        type: 'text',
        text: text
    };
    if (marks.length > 0) {
        node.marks = marks;
    }
    return node;
}

/**
 * Create a mark (formatting like bold, italic, code)
 */
function createMark(type, attrs = {}) {
    return { type, attrs };
}

/**
 * Parse inline markdown formatting and return text nodes with marks
 */
function parseInlineFormatting(text) {
    const nodes = [];
    let currentPos = 0;
    let currentText = '';
    let currentMarks = [];

    // Patterns for markdown formatting
    const patterns = [
        { regex: /\*\*([^*]+)\*\*/g, mark: 'strong' },      // Bold
        { regex: /__([^_]+)__/g, mark: 'strong' },          // Bold (underscore)
        { regex: /\*([^*]+)\*/g, mark: 'em' },              // Italic
        { regex: /_([^_]+)_/g, mark: 'em' },                // Italic (underscore)
        { regex: /`([^`]+)`/g, mark: 'code' },              // Inline code
        { regex: /\[([^\]]+)\]\(([^)]+)\)/g, mark: 'link' } // Links
    ];

    // Simple approach: process text character by character and detect patterns
    // For now, use a simpler regex-based approach
    // Use a placeholder format that won't be interpreted as markdown (no underscores)
    let processed = text;
    const placeholders = new Map();
    let placeholderId = 0;

    // Process code first (backticks) - highest priority
    processed = processed.replace(/`([^`]+)`/g, (match, code) => {
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'code', text: code });
        return id;
    });

    // Process links
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'link', text: linkText, url: url });
        return id;
    });

    // Process bold (must come before italic)
    processed = processed.replace(/\*\*([^*]+)\*\*/g, (match, boldText) => {
        if (match.includes('\u0001PLACEHOLDER')) return match; // Skip if contains placeholder
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'strong', text: boldText });
        return id;
    });
    processed = processed.replace(/__([^_]+)__/g, (match, boldText) => {
        if (match.includes('\u0001PLACEHOLDER')) return match;
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'strong', text: boldText });
        return id;
    });

    // Process italic
    processed = processed.replace(/\*([^*]+)\*/g, (match, italicText) => {
        if (match.includes('\u0001PLACEHOLDER')) return match;
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'em', text: italicText });
        return id;
    });
    processed = processed.replace(/_([^_]+)_/g, (match, italicText) => {
        if (match.includes('\u0001PLACEHOLDER')) return match;
        const id = `\u0001PLACEHOLDER${placeholderId++}\u0001`;
        placeholders.set(id, { type: 'em', text: italicText });
        return id;
    });

    // Split by placeholders and build nodes
    // Use control character (SOH) to mark placeholders - won't be interpreted as markdown
    const placeholderRegex = /(\u0001PLACEHOLDER\d+\u0001)/g;
    const parts = processed.split(placeholderRegex);

    for (const part of parts) {
        if (!part) continue; // Skip empty strings

        if (part.startsWith('\u0001PLACEHOLDER') && placeholders.has(part)) {
            const placeholder = placeholders.get(part);
            const marks = [];

            if (placeholder.type === 'strong') {
                marks.push(createMark('strong'));
            } else if (placeholder.type === 'em') {
                marks.push(createMark('em'));
            } else if (placeholder.type === 'code') {
                marks.push(createMark('code'));
            }

            if (placeholder.type === 'link') {
                nodes.push({
                    type: 'text',
                    text: placeholder.text,
                    marks: [{ type: 'link', attrs: { href: placeholder.url } }]
                });
            } else {
                nodes.push(createTextNode(placeholder.text, marks));
            }
        } else if (part && !part.startsWith('\u0001PLACEHOLDER')) {
            // Only add non-placeholder text
            nodes.push(createTextNode(part));
        }
    }

    return nodes.length > 0 ? nodes : [createTextNode(text)];
}

/**
 * Count headings in markdown to determine if TOC is needed
 */
function countHeadings(markdown) {
    const headingRegex = /^#{1,6}\s+.+$/gm;
    const matches = markdown.match(headingRegex);
    return matches ? matches.length : 0;
}

/**
 * Create a table of contents macro for Confluence
 */
function createTableOfContents() {
    return {
        type: 'extension',
        attrs: {
            extensionType: 'com.atlassian.confluence.macro.core',
            extensionKey: 'toc',
            parameters: {
                macroParams: {
                    minLevel: { value: '1' },
                    maxLevel: { value: '3' },
                    style: { value: 'default' }
                }
            }
        }
    };
}

/**
 * Parse a markdown table into ADF table format
 */
function parseTable(lines, startIndex) {
    const tableRows = [];
    let i = startIndex;

    // Check if this is a valid table (header row, separator row, data rows)
    const headerRow = lines[i];
    const separatorRow = lines[i + 1];

    // Separator row must have pipes and dashes
    if (!separatorRow || !separatorRow.match(/^\|?[\s\-:|]+\|?$/)) {
        return { table: null, endIndex: startIndex };
    }

    // Parse all table rows
    while (i < lines.length) {
        const line = lines[i];

        // Stop if line doesn't look like a table row
        if (!line.includes('|')) {
            break;
        }

        // Skip separator row
        if (line.match(/^\|?[\s\-:|]+\|?$/)) {
            i++;
            continue;
        }

        // Parse cells from the row
        const cells = line
            .split('|')
            .map(cell => cell.trim())
            .filter((cell, idx, arr) => {
                // Remove empty cells at start and end (from leading/trailing pipes)
                if (idx === 0 && cell === '') return false;
                if (idx === arr.length - 1 && cell === '') return false;
                return true;
            });

        if (cells.length > 0) {
            const isHeader = tableRows.length === 0;
            const row = {
                type: 'tableRow',
                content: cells.map(cellContent => ({
                    type: isHeader ? 'tableHeader' : 'tableCell',
                    attrs: {},
                    content: [{
                        type: 'paragraph',
                        content: parseInlineFormatting(cellContent)
                    }]
                }))
            };
            tableRows.push(row);
        }

        i++;
    }

    if (tableRows.length < 2) {
        // Not enough rows for a valid table
        return { table: null, endIndex: startIndex };
    }

    return {
        table: {
            type: 'table',
            attrs: {
                isNumberColumnEnabled: false,
                layout: 'default'
            },
            content: tableRows
        },
        endIndex: i - 1
    };
}

/**
 * Convert markdown to atlas_doc_format
 */
function convertMarkdownToAtlasDoc(markdown, options = {}) {
    const { addTableOfContents = true, tocThreshold = 4 } = options;

    // Remove GITHUB_ONLY and PPT_ONLY blocks (should already be filtered, but be safe)
    // Remove multi-line blocks (case-insensitive, flexible whitespace)
    markdown = markdown.replace(/<!--\s*GITHUB_ONLY\s*-->[\s\S]*?<!--\s*\/\s*GITHUB_ONLY\s*-->/gi, '');
    markdown = markdown.replace(/<!--\s*PPT_ONLY\s*-->[\s\S]*?<!--\s*\/\s*PPT_ONLY\s*-->/gi, '');
    // Remove single-line blocks
    markdown = markdown.replace(/<!--\s*GITHUB_ONLY\s*-->.*?<!--\s*\/\s*GITHUB_ONLY\s*-->/gi, '');
    markdown = markdown.replace(/<!--\s*PPT_ONLY\s*-->.*?<!--\s*\/\s*PPT_ONLY\s*-->/gi, '');
    // Remove CONFLUENCE_ONLY markers (keep content, remove markers)
    markdown = markdown.replace(/<!--\s*CONFLUENCE_ONLY\s*-->/gi, '');
    markdown = markdown.replace(/<!--\s*\/\s*CONFLUENCE_ONLY\s*-->/gi, '');
    // Remove Astro/MDX note blocks (:::note[...], :::warning, etc.) - these are Astro-specific
    markdown = markdown.replace(/^:::[a-zA-Z]+(\[[^\]]*\])?[\s\S]*?^:::$/gm, '');

    const lines = markdown.split('\n');
    const doc = {
        type: 'doc',
        version: 1,
        content: []
    };

    // Count headings to determine if TOC should be added
    const headingCount = countHeadings(markdown);
    const shouldAddToc = addTableOfContents && headingCount >= tocThreshold;
    let tocInserted = false;
    let warningPanelSeen = false;

    let inCodeBlock = false;
    let codeBlockContent = [];
    let codeBlockLanguage = null;
    // Stack to track nested lists: [{ type, items, indent }]
    let listStack = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Skip lines that are just GITHUB_ONLY or PPT_ONLY tags (shouldn't happen after filtering, but be safe)
        if (line.trim().match(/^<!--\s*(GITHUB_ONLY|PPT_ONLY|CONFLUENCE_ONLY|\/\s*(GITHUB_ONLY|PPT_ONLY|CONFLUENCE_ONLY))\s*-->$/i)) {
            continue;
        }

        // Handle code blocks
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                // End code block - join all lines with newlines into a single text node
                const language = codeBlockLanguage || 'plain';
                const codeText = codeBlockContent.join('\n');
                doc.content.push({
                    type: 'codeBlock',
                    attrs: { language: language },
                    content: codeText ? [createTextNode(codeText)] : []
                });
                codeBlockContent = [];
                codeBlockLanguage = null;
                inCodeBlock = false;
            } else {
                // Start code block
                inCodeBlock = true;
                codeBlockLanguage = line.trim().substring(3).trim() || null;
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent.push(line);
            continue;
        }

        // Handle tables (check for markdown table syntax)
        if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?[\s\-:|]+\|?$/)) {
            // This looks like a table header row followed by separator
            const { table, endIndex } = parseTable(lines, i);
            if (table) {
                doc.content.push(table);
                i = endIndex;
                continue;
            }
        }

        // Handle list items
        const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (listMatch) {
            const indent = listMatch[1].length;
            const marker = listMatch[2];
            const content = listMatch[3];
            const isOrdered = /^\d+\.$/.test(marker);
            const listType = isOrdered ? 'orderedList' : 'bulletList';

            // Close any lists that are at a deeper indent level (we're going shallower)
            while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
                const finishedList = listStack.pop();
                // If this list has a nestedListNode, update it with the final items
                if (finishedList.nestedListNode) {
                    finishedList.nestedListNode.content = finishedList.items;
                } else if (listStack.length > 0) {
                    // Add finished list as nested list in parent listItem
                    const parentList = listStack[listStack.length - 1];
                    const lastItem = parentList.items[parentList.items.length - 1];
                    // Check if we already added a list of this type (avoid duplicates)
                    const existingList = lastItem.content.find(c =>
                        (c.type === 'bulletList' || c.type === 'orderedList')
                    );
                    if (!existingList) {
                        lastItem.content.push({
                            type: finishedList.type,
                            content: finishedList.items
                        });
                    } else {
                        // Merge items into existing list
                        existingList.content.push(...finishedList.items);
                    }
                } else {
                    // Top-level list finished, add to doc
                    doc.content.push({
                        type: finishedList.type,
                        content: finishedList.items
                    });
                }
            }

            // Check if we have a list at the current indent level with matching type
            let currentList = null;
            if (listStack.length > 0 && listStack[listStack.length - 1].indent === indent) {
                const topList = listStack[listStack.length - 1];
                if (topList.type === listType) {
                    currentList = topList;
                } else {
                    // Different type at same indent - close the old list
                    const finishedList = listStack.pop();
                    // If this list has a nestedListNode, update it with the final items
                    if (finishedList.nestedListNode) {
                        finishedList.nestedListNode.content = finishedList.items;
                    } else if (listStack.length > 0) {
                        const parentList = listStack[listStack.length - 1];
                        const lastItem = parentList.items[parentList.items.length - 1];
                        const existingList = lastItem.content.find(c =>
                            (c.type === 'bulletList' || c.type === 'orderedList')
                        );
                        if (!existingList) {
                            lastItem.content.push({
                                type: finishedList.type,
                                content: finishedList.items
                            });
                        } else {
                            existingList.content.push(...finishedList.items);
                        }
                    } else {
                        doc.content.push({
                            type: finishedList.type,
                            content: finishedList.items
                        });
                    }
                }
            }

            // If we need a new list at this indent level
            if (!currentList) {
                const newList = {
                    type: listType,
                    items: [],
                    indent: indent
                };
                listStack.push(newList);
                currentList = newList;

                // If this is a nested list (indent > 0), add it to the parent listItem's content
                if (listStack.length > 1) {
                    const parentList = listStack[listStack.length - 2];
                    const lastItem = parentList.items[parentList.items.length - 1];
                    // Create the nested list structure in the parent item
                    const nestedList = {
                        type: listType,
                        content: []  // Will be populated as we add items
                    };
                    lastItem.content.push(nestedList);
                    // Store reference to the actual nested list node so we can update it
                    newList.nestedListNode = nestedList;
                }
            }

            // Create list item
            const paragraphContent = parseInlineFormatting(content);
            const listItem = {
                type: 'listItem',
                content: [{
                    type: 'paragraph',
                    content: paragraphContent.length > 0 ? paragraphContent : [createTextNode('')]
                }]
            };

            // Add to current list
            currentList.items.push(listItem);
            continue;
        }

        // Close all lists if we hit a non-list line
        while (listStack.length > 0) {
            const finishedList = listStack.pop();
            if (listStack.length > 0) {
                // Add finished list as nested list in parent listItem
                const parentList = listStack[listStack.length - 1];
                const lastItem = parentList.items[parentList.items.length - 1];
                if (!lastItem.content.find(c => c.type === finishedList.type || c.type === 'orderedList' || c.type === 'bulletList')) {
                    lastItem.content.push({
                        type: finishedList.type,
                        content: finishedList.items
                    });
                }
            } else {
                // Top-level list finished, add to doc
                doc.content.push({
                    type: finishedList.type,
                    content: finishedList.items
                });
            }
        }

        // Handle headings
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2];
            doc.content.push({
                type: 'heading',
                attrs: { level: level },
                content: parseInlineFormatting(text)
            });
            continue;
        }

        // Handle horizontal rules
        if (line.trim().match(/^[-*_]{3,}$/)) {
            doc.content.push({ type: 'rule' });
            continue;
        }

        // Handle empty lines
        if (line.trim().length === 0) {
            // Skip empty lines - Confluence automatically adds spacing between different content types
            // (headings, lists, paragraphs, etc.), so we don't need to add empty paragraphs
            continue;
        }

        // Handle images (basic markdown image syntax)
        if (line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)) {
            const imageMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            doc.content.push({
                type: 'paragraph',
                content: [{
                    type: 'media',
                    attrs: {
                        type: 'file',
                        url: imageMatch[2],
                        alt: imageMatch[1] || ''
                    }
                }]
            });
            continue;
        }

        // Handle Confluence image placeholders (from LikeC4 diagrams)
        // Format: <ac:image-placeholder-viewid="viewId"/>
        // These can appear anywhere in the line, not just at the start
        if (line.includes('<ac:image-placeholder-viewid=')) {
            // Extract all placeholders from the line
            const placeholderRegex = /<ac:image-placeholder-viewid="([^"]+)"\s*\/?>/g;
            let match;
            let lastIndex = 0;
            const paragraphContent = [];

            while ((match = placeholderRegex.exec(line)) !== null) {
                // Add text before the placeholder
                if (match.index > lastIndex) {
                    const textBefore = line.substring(lastIndex, match.index);
                    if (textBefore.trim().length > 0) {
                        paragraphContent.push(...parseInlineFormatting(textBefore));
                    }
                }

                // Add placeholder media node
                const viewId = match[1];
                paragraphContent.push({
                    type: 'media',
                    attrs: {
                        type: 'file',
                        __placeholder_viewid: viewId  // Special marker for replacement
                    }
                });

                lastIndex = match.index + match[0].length;
            }

            // Add remaining text after last placeholder
            if (lastIndex < line.length) {
                const textAfter = line.substring(lastIndex);
                if (textAfter.trim().length > 0) {
                    paragraphContent.push(...parseInlineFormatting(textAfter));
                }
            }

            if (paragraphContent.length > 0) {
                doc.content.push({
                    type: 'paragraph',
                    content: paragraphContent
                });
            }
            continue;
        }

        // Regular paragraph
        const paragraphContent = parseInlineFormatting(line);
        doc.content.push({
            type: 'paragraph',
            content: paragraphContent.length > 0 ? paragraphContent : [createTextNode('')]
        });
    }

    // Close any open lists
    while (listStack.length > 0) {
        const finishedList = listStack.pop();
        // If this list has a nestedListNode, update it with the final items
        if (finishedList.nestedListNode) {
            finishedList.nestedListNode.content = finishedList.items;
        } else if (listStack.length > 0) {
            // Add finished list as nested list in parent listItem
            const parentList = listStack[listStack.length - 1];
            const lastItem = parentList.items[parentList.items.length - 1];
            if (!lastItem.content.find(c => c.type === finishedList.type || c.type === 'orderedList' || c.type === 'bulletList')) {
                lastItem.content.push({
                    type: finishedList.type,
                    content: finishedList.items
                });
            }
        } else {
            // Top-level list finished, add to doc
            doc.content.push({
                type: finishedList.type,
                content: finishedList.items
            });
        }
    }

    // Remove trailing empty paragraphs
    while (doc.content.length > 0 &&
        doc.content[doc.content.length - 1].type === 'paragraph' &&
        (doc.content[doc.content.length - 1].content.length === 0 ||
            (doc.content[doc.content.length - 1].content.length === 1 &&
                doc.content[doc.content.length - 1].content[0].type === 'text' &&
                doc.content[doc.content.length - 1].content[0].text.trim() === ''))) {
        doc.content.pop();
    }

    // Add table of contents if there are enough headings
    // Insert at the very beginning - the warning panel will be prepended by the publish script
    // so final order will be: Warning Panel → TOC → Content
    if (shouldAddToc && doc.content.length > 0) {
        doc.content.unshift(createTableOfContents());
    }

    return doc;
}

// Read from stdin
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

let markdown = '';

rl.on('line', (line) => {
    markdown += line + '\n';
});

rl.on('close', () => {
    try {
        const atlasDoc = convertMarkdownToAtlasDoc(markdown);
        // Output as compact JSON (single line) for use in shell script
        console.log(JSON.stringify(atlasDoc));
    } catch (error) {
        console.error('Error converting markdown to atlas_doc_format:', error.message);
        process.exit(1);
    }
});

