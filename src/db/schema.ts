import Database from 'better-sqlite3';

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
-- FTS5 virtual table for docs full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title,
    content,
    module,
    category,
    content='docs',
    content_rowid='id'
);

-- FTS5 virtual table for members full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS members_fts USING fts5(
    name,
    signature,
    natspec_notice,
    natspec_dev,
    content='members',
    content_rowid='id'
);

-- Triggers to keep FTS indexes in sync
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
    INSERT INTO docs_fts(rowid, title, content, module, category)
    VALUES (new.id, new.title, new.content, new.module, new.category);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, title, content, module, category)
    VALUES('delete', old.id, old.title, old.content, old.module, old.category);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, title, content, module, category)
    VALUES('delete', old.id, old.title, old.content, old.module, old.category);
    INSERT INTO docs_fts(rowid, title, content, module, category)
    VALUES (new.id, new.title, new.content, new.module, new.category);
END;

CREATE TRIGGER IF NOT EXISTS members_ai AFTER INSERT ON members BEGIN
    INSERT INTO members_fts(rowid, name, signature, natspec_notice, natspec_dev)
    VALUES (new.id, new.name, new.signature, new.natspec_notice, new.natspec_dev);
END;

CREATE TRIGGER IF NOT EXISTS members_ad AFTER DELETE ON members BEGIN
    INSERT INTO members_fts(members_fts, rowid, name, signature, natspec_notice, natspec_dev)
    VALUES('delete', old.id, old.name, old.signature, old.natspec_notice, old.natspec_dev);
END;

CREATE TRIGGER IF NOT EXISTS members_au AFTER UPDATE ON members BEGIN
    INSERT INTO members_fts(members_fts, rowid, name, signature, natspec_notice, natspec_dev)
    VALUES('delete', old.id, old.name, old.signature, old.natspec_notice, old.natspec_dev);
    INSERT INTO members_fts(rowid, name, signature, natspec_notice, natspec_dev)
    VALUES (new.id, new.name, new.signature, new.natspec_notice, new.natspec_dev);
END;
`;

export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Execute schema
  db.exec(SCHEMA_SQL);
  db.exec(FTS_SCHEMA_SQL);

  return db;
}

export function resetDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Drop all tables
  db.exec(`
    DROP TABLE IF EXISTS docs_fts;
    DROP TABLE IF EXISTS members_fts;
    DROP TRIGGER IF EXISTS docs_ai;
    DROP TRIGGER IF EXISTS docs_ad;
    DROP TRIGGER IF EXISTS docs_au;
    DROP TRIGGER IF EXISTS members_ai;
    DROP TRIGGER IF EXISTS members_ad;
    DROP TRIGGER IF EXISTS members_au;
    DROP TABLE IF EXISTS members;
    DROP TABLE IF EXISTS contracts;
    DROP TABLE IF EXISTS docs;
  `);

  // Recreate schema
  db.exec(SCHEMA_SQL);
  db.exec(FTS_SCHEMA_SQL);

  return db;
}
