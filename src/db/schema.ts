import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Re-export the Database type for use in other modules
export type Database = SqlJsDatabase;

// Cache the SQL.js initialization
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
  if (!SQL) {
    // Locate the WASM file from the sql.js package
    const sqlJsPath = require.resolve('sql.js');
    const distDir = path.dirname(sqlJsPath);
    SQL = await initSqlJs({
      locateFile: (file: string) => path.join(distDir, file)
    });
  }
  return SQL;
}

export const SCHEMA_SQL = `
-- Main documentation chunks
CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,
    version TEXT NOT NULL,           -- '4.x' or '5.x'
    category TEXT NOT NULL,          -- 'access', 'token', 'utils', 'governance', 'proxy', etc.
    module TEXT NOT NULL,            -- 'ERC20', 'Ownable', 'ECDSA', etc.
    title TEXT NOT NULL,
    content TEXT NOT NULL,           -- Full text content
    source_type TEXT NOT NULL,       -- 'guide', 'api', 'natspec'
    source_url TEXT,                 -- Link to docs.openzeppelin.com
    file_path TEXT                   -- Original file path
);

-- Contract/Library specific info extracted from source
CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY,
    version TEXT NOT NULL,
    name TEXT NOT NULL,              -- 'ERC20', 'SafeERC20', etc.
    type TEXT NOT NULL,              -- 'contract', 'library', 'interface', 'abstract'
    category TEXT NOT NULL,
    inheritance TEXT,                -- JSON array of parent contracts
    natspec_notice TEXT,             -- @notice from NatSpec
    source_url TEXT
);

-- Functions, events, errors, modifiers
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY,
    contract_id INTEGER REFERENCES contracts(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL,              -- 'function', 'event', 'error', 'modifier'
    signature TEXT NOT NULL,         -- Full signature
    visibility TEXT,                 -- 'public', 'external', 'internal', 'private'
    mutability TEXT,                 -- 'view', 'pure', 'payable', ''
    params TEXT,                     -- JSON array of {name, type, description}
    returns TEXT,                    -- JSON array of {type, description}
    natspec_notice TEXT,
    natspec_dev TEXT,
    example_code TEXT
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_docs_version ON docs(version);
CREATE INDEX IF NOT EXISTS idx_docs_category ON docs(category);
CREATE INDEX IF NOT EXISTS idx_docs_module ON docs(module);
CREATE INDEX IF NOT EXISTS idx_contracts_version ON contracts(version);
CREATE INDEX IF NOT EXISTS idx_contracts_name ON contracts(name);
CREATE INDEX IF NOT EXISTS idx_contracts_category ON contracts(category);
CREATE INDEX IF NOT EXISTS idx_members_contract_id ON members(contract_id);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(name);
CREATE INDEX IF NOT EXISTS idx_members_type ON members(type);
`;

export const FTS_SCHEMA_SQL = `
-- FTS4 virtual table for docs full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts4(
    title,
    content,
    module,
    category,
    content='docs'
);

-- FTS4 virtual table for members full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS members_fts USING fts4(
    name,
    signature,
    natspec_notice,
    natspec_dev,
    content='members'
);

-- Triggers to keep FTS indexes in sync
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
    INSERT INTO docs_fts(docid, title, content, module, category)
    VALUES (new.id, new.title, new.content, new.module, new.category);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
    DELETE FROM docs_fts WHERE docid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
    DELETE FROM docs_fts WHERE docid = old.id;
    INSERT INTO docs_fts(docid, title, content, module, category)
    VALUES (new.id, new.title, new.content, new.module, new.category);
END;

CREATE TRIGGER IF NOT EXISTS members_ai AFTER INSERT ON members BEGIN
    INSERT INTO members_fts(docid, name, signature, natspec_notice, natspec_dev)
    VALUES (new.id, new.name, new.signature, new.natspec_notice, new.natspec_dev);
END;

CREATE TRIGGER IF NOT EXISTS members_ad AFTER DELETE ON members BEGIN
    DELETE FROM members_fts WHERE docid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS members_au AFTER UPDATE ON members BEGIN
    DELETE FROM members_fts WHERE docid = old.id;
    INSERT INTO members_fts(docid, name, signature, natspec_notice, natspec_dev)
    VALUES (new.id, new.name, new.signature, new.natspec_notice, new.natspec_dev);
END;
`;

export async function openDatabase(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    return new SQL.Database(buffer);
  }

  throw new Error(`Database not found at ${dbPath}`);
}

export async function initializeDatabase(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();

  let db: SqlJsDatabase;

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Execute schema
  db.run(SCHEMA_SQL);
  db.run(FTS_SCHEMA_SQL);

  // Save to file
  saveDatabase(db, dbPath);

  return db;
}

export async function resetDatabase(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  // Execute schema (no need to drop since it's a fresh database)
  db.run(SCHEMA_SQL);
  db.run(FTS_SCHEMA_SQL);

  // Save to file
  saveDatabase(db, dbPath);

  return db;
}

export function saveDatabase(db: SqlJsDatabase, dbPath: string): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}
