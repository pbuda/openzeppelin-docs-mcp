import path from 'path';
import fs from 'fs/promises';
import { resetDatabase, saveDatabase, type Database } from '../db/schema.js';
import { fetchDocs, getReposPaths } from './fetch-docs.js';
import { parseMdxFiles } from './parse-mdx.js';
import { parseSolidityFiles } from './parse-solidity.js';
import type { DocChunk, ContractInfo } from '../types.js';

export interface BuildOptions {
  dataDir: string;
  dbPath: string;
  skipFetch?: boolean;
  force?: boolean;
}

export async function buildIndex(options: BuildOptions): Promise<void> {
  const { dataDir, dbPath, skipFetch = false, force = false } = options;

  console.log('=== OpenZeppelin Docs Indexer ===\n');

  // Step 1: Fetch docs (unless skipped)
  if (!skipFetch) {
    console.log('Step 1: Fetching documentation repositories...');
    await fetchDocs({ dataDir, force });
    console.log('');
  } else {
    console.log('Step 1: Skipping fetch (using existing repos)\n');
  }

  // Step 2: Initialize/reset database
  console.log('Step 2: Initializing database...');
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = await resetDatabase(dbPath);
  console.log(`Database created at ${dbPath}\n`);

  const repos = getReposPaths(dataDir);

  // Step 3: Parse and index MDX documentation
  console.log('Step 3: Parsing MDX documentation...');
  const docChunks = await parseMdxFiles(repos.docs);
  console.log(`Found ${docChunks.length} documentation chunks`);
  insertDocs(db, docChunks);
  console.log('');

  // Step 4: Parse and index Solidity contracts (v5)
  console.log('Step 4: Parsing Solidity contracts (v5.x)...');
  const contractsV5 = await parseSolidityFiles(repos.contractsV5, '5.x');
  console.log(`Found ${contractsV5.length} contracts in v5`);
  insertContracts(db, contractsV5);
  console.log('');

  // Step 5: Parse and index Solidity contracts (v4)
  console.log('Step 5: Parsing Solidity contracts (v4.x)...');
  const contractsV4 = await parseSolidityFiles(repos.contractsV4, '4.x');
  console.log(`Found ${contractsV4.length} contracts in v4`);
  insertContracts(db, contractsV4);
  console.log('');

  // Step 6: Output stats
  console.log('=== Indexing Complete ===');
  printStats(db);

  // Save and close
  saveDatabase(db, dbPath);
  db.close();
}

function insertDocs(db: Database, chunks: DocChunk[]): void {
  // Use a transaction for better performance
  db.run('BEGIN TRANSACTION');

  try {
    for (const chunk of chunks) {
      db.run(`
        INSERT INTO docs (version, category, module, title, content, source_type, source_url, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        chunk.version,
        chunk.category,
        chunk.module,
        chunk.title,
        chunk.content,
        chunk.sourceType,
        chunk.sourceUrl || null,
        chunk.filePath || null
      ]);
    }

    db.run('COMMIT');
    console.log(`Inserted ${chunks.length} documentation chunks`);
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function insertContracts(db: Database, contracts: ContractInfo[]): void {
  db.run('BEGIN TRANSACTION');

  try {
    let memberCount = 0;

    for (const contract of contracts) {
      db.run(`
        INSERT INTO contracts (version, name, type, category, inheritance, natspec_notice, source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        contract.version,
        contract.name,
        contract.type,
        contract.category,
        JSON.stringify(contract.inheritance),
        contract.natspecNotice || null,
        contract.sourceUrl || null
      ]);

      // Get the last inserted contract ID
      const result = db.exec('SELECT last_insert_rowid() as id');
      const contractId = result[0].values[0][0] as number;

      // Insert functions
      for (const func of contract.functions) {
        db.run(`
          INSERT INTO members (contract_id, name, type, signature, visibility, mutability, params, returns, natspec_notice, natspec_dev, example_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          contractId,
          func.name,
          'function',
          func.signature,
          func.visibility,
          func.mutability || null,
          JSON.stringify(func.params),
          JSON.stringify(func.returns),
          func.natspecNotice || null,
          func.natspecDev || null,
          func.exampleCode || null
        ]);
        memberCount++;
      }

      // Insert events
      for (const event of contract.events) {
        db.run(`
          INSERT INTO members (contract_id, name, type, signature, visibility, mutability, params, returns, natspec_notice, natspec_dev, example_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          contractId,
          event.name,
          'event',
          event.signature,
          null,
          null,
          JSON.stringify(event.params),
          '[]',
          event.natspecNotice || null,
          event.natspecDev || null,
          null
        ]);
        memberCount++;
      }

      // Insert errors
      for (const error of contract.errors) {
        db.run(`
          INSERT INTO members (contract_id, name, type, signature, visibility, mutability, params, returns, natspec_notice, natspec_dev, example_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          contractId,
          error.name,
          'error',
          error.signature,
          null,
          null,
          JSON.stringify(error.params),
          '[]',
          error.natspecNotice || null,
          error.natspecDev || null,
          null
        ]);
        memberCount++;
      }

      // Insert modifiers
      for (const modifier of contract.modifiers) {
        db.run(`
          INSERT INTO members (contract_id, name, type, signature, visibility, mutability, params, returns, natspec_notice, natspec_dev, example_code)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          contractId,
          modifier.name,
          'modifier',
          modifier.signature,
          null,
          null,
          JSON.stringify(modifier.params),
          '[]',
          modifier.natspecNotice || null,
          modifier.natspecDev || null,
          null
        ]);
        memberCount++;
      }
    }

    db.run('COMMIT');
    console.log(`Inserted ${contracts.length} contracts with ${memberCount} members`);
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

function queryOne<T>(db: Database, sql: string): T {
  const result = db.exec(sql);
  if (result.length === 0 || result[0].values.length === 0) {
    return { count: 0 } as T;
  }
  const columns = result[0].columns;
  const values = result[0].values[0];
  const obj: Record<string, unknown> = {};
  columns.forEach((col, i) => {
    obj[col] = values[i];
  });
  return obj as T;
}

function queryAll<T>(db: Database, sql: string): T[] {
  const result = db.exec(sql);
  if (result.length === 0) {
    return [];
  }
  const columns = result[0].columns;
  return result[0].values.map(row => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

function printStats(db: Database): void {
  const docsCount = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM docs');
  const contractsCount = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM contracts');
  const membersCount = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM members');

  const contractsByVersion = queryAll<{ version: string; count: number }>(db, `
    SELECT version, COUNT(*) as count FROM contracts GROUP BY version
  `);

  const membersByType = queryAll<{ type: string; count: number }>(db, `
    SELECT type, COUNT(*) as count FROM members GROUP BY type
  `);

  console.log(`\nDatabase Statistics:`);
  console.log(`  Documentation chunks: ${docsCount.count}`);
  console.log(`  Contracts: ${contractsCount.count}`);
  for (const row of contractsByVersion) {
    console.log(`    - ${row.version}: ${row.count}`);
  }
  console.log(`  Members: ${membersCount.count}`);
  for (const row of membersByType) {
    console.log(`    - ${row.type}: ${row.count}`);
  }
}
