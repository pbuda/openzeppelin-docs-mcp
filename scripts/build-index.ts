#!/usr/bin/env tsx
import path from 'path';
import { fileURLToPath } from 'url';
import { buildIndex } from '../src/indexer/build-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const dataDir = path.join(projectRoot, 'data');
const dbPath = path.join(dataDir, 'oz-docs.db');

// Parse CLI arguments
const args = process.argv.slice(2);
const skipFetch = args.includes('--skip-fetch');
const force = args.includes('--force');

async function main() {
  try {
    await buildIndex({
      dataDir,
      dbPath,
      skipFetch,
      force,
    });
    console.log('\nIndex build complete!');
  } catch (error) {
    console.error('Error building index:', error);
    process.exit(1);
  }
}

main();
