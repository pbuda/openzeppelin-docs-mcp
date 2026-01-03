import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import type { DocChunk } from '../types.js';
import type { Root, Content, Heading, Code, Text } from 'mdast';

// Category mapping from file paths
const CATEGORY_PATTERNS: Record<string, RegExp> = {
  access: /\/(access|api\/access)\//,
  token: /\/(token|api\/token)\//,
  utils: /\/(utils|api\/utils)\//,
  governance: /\/(governance|api\/governance)\//,
  proxy: /\/(proxy|api\/proxy)\//,
  finance: /\/(finance|api\/finance)\//,
  metatx: /\/(metatx|api\/metatx)\//,
  interfaces: /\/(interfaces|api\/interfaces)\//,
  crosschain: /\/(crosschain|api\/crosschain)\//,
};

interface ParsedSection {
  title: string;
  content: string;
  level: number;
  codeExamples: string[];
}

export async function parseMdxFiles(docsDir: string): Promise<DocChunk[]> {
  const chunks: DocChunk[] = [];

  // Find MDX files for both versions
  const v5Pattern = path.join(docsDir, 'modules/ROOT/pages/**/*.adoc');
  const v5PatternMdx = path.join(docsDir, 'content/contracts/5.x/**/*.mdx');
  const v4PatternMdx = path.join(docsDir, 'content/contracts/4.x/**/*.mdx');

  // Try both patterns since the docs structure may vary
  const patterns = [v5PatternMdx, v4PatternMdx];

  for (const pattern of patterns) {
    const files = await glob(pattern);
    console.log(`Found ${files.length} MDX files matching ${pattern}`);

    for (const filePath of files) {
      try {
        const fileChunks = await parseMdxFile(filePath);
        chunks.push(...fileChunks);
      } catch (error) {
        console.warn(`Warning: Failed to parse ${filePath}:`, error);
      }
    }
  }

  return chunks;
}

export async function parseMdxFile(filePath: string): Promise<DocChunk[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const version = detectVersion(filePath);
  const category = detectCategory(filePath);
  const module = detectModule(filePath);

  // Extract frontmatter if present
  const { frontmatter, body } = extractFrontmatter(content);

  // Parse MDX to AST
  const tree = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .parse(body) as Root;

  // Extract sections from AST
  const sections = extractSections(tree);

  // Convert sections to DocChunks
  const chunks: DocChunk[] = [];

  // If no sections found, create a single chunk for the whole document
  if (sections.length === 0) {
    const allContent = extractAllText(tree);
    if (allContent.trim()) {
      chunks.push({
        title: frontmatter.title || module,
        content: allContent,
        category,
        module,
        version,
        sourceType: detectSourceType(filePath),
        sourceUrl: buildSourceUrl(filePath, version),
        filePath,
      });
    }
  } else {
    // Create chunks for each section
    for (const section of sections) {
      if (section.content.trim()) {
        chunks.push({
          title: section.title || frontmatter.title || module,
          content: section.content,
          category,
          module,
          version,
          sourceType: detectSourceType(filePath),
          sourceUrl: buildSourceUrl(filePath, version),
          filePath,
        });
      }
    }
  }

  return chunks;
}

function extractFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  let body = content;

  // Check for YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (yamlMatch) {
    const yamlContent = yamlMatch[1];
    body = yamlMatch[2];

    // Simple YAML parsing for key: value pairs
    for (const line of yamlContent.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, '');
      }
    }
  }

  return { frontmatter, body };
}

function extractSections(tree: Root): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  visit(tree, (node: Content) => {
    if (node.type === 'heading') {
      const heading = node as Heading;
      // Only split on h2 and h3
      if (heading.depth === 2 || heading.depth === 3) {
        if (currentSection && currentSection.content.trim()) {
          sections.push(currentSection);
        }
        currentSection = {
          title: extractHeadingText(heading),
          content: '',
          level: heading.depth,
          codeExamples: [],
        };
      }
    } else if (currentSection) {
      if (node.type === 'code') {
        const code = node as Code;
        currentSection.codeExamples.push(code.value);
        currentSection.content += `\n\`\`\`${code.lang || ''}\n${code.value}\n\`\`\`\n`;
      } else if (node.type === 'paragraph' || node.type === 'text') {
        currentSection.content += extractNodeText(node) + '\n';
      }
    }
  });

  // Don't forget the last section
  if (currentSection && currentSection.content.trim()) {
    sections.push(currentSection);
  }

  return sections;
}

function extractHeadingText(heading: Heading): string {
  let text = '';
  visit(heading, 'text', (node: Text) => {
    text += node.value;
  });
  return text;
}

function extractNodeText(node: Content): string {
  if (node.type === 'text') {
    return (node as Text).value;
  }

  let text = '';
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      text += extractNodeText(child as Content);
    }
  }
  return text;
}

function extractAllText(tree: Root): string {
  let text = '';

  visit(tree, (node: Content) => {
    if (node.type === 'text') {
      text += (node as Text).value + ' ';
    } else if (node.type === 'code') {
      const code = node as Code;
      text += `\n\`\`\`${code.lang || ''}\n${code.value}\n\`\`\`\n`;
    }
  });

  return text.trim();
}

function detectVersion(filePath: string): string {
  if (filePath.includes('/5.x/') || filePath.includes('/v5') || filePath.includes('contracts-v5')) {
    return '5.x';
  }
  if (filePath.includes('/4.x/') || filePath.includes('/v4') || filePath.includes('contracts-v4')) {
    return '4.x';
  }
  return '5.x'; // Default to latest
}

function detectCategory(filePath: string): string {
  for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(filePath)) {
      return category;
    }
  }
  return 'general';
}

function detectModule(filePath: string): string {
  // Extract module name from file name
  const basename = path.basename(filePath, path.extname(filePath));

  // Convert kebab-case or snake_case to PascalCase for common patterns
  if (basename.startsWith('erc')) {
    return basename.toUpperCase().replace(/-/g, '');
  }

  return basename
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function detectSourceType(filePath: string): 'guide' | 'api' | 'natspec' {
  if (filePath.includes('/api/')) {
    return 'api';
  }
  return 'guide';
}

function buildSourceUrl(filePath: string, version: string): string {
  // Build URL to docs.openzeppelin.com
  const relativePath = filePath
    .replace(/.*\/content\/contracts\//, '')
    .replace(/\.mdx$/, '');

  return `https://docs.openzeppelin.com/contracts/${version}/${relativePath}`;
}
