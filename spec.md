# OpenZeppelin Documentation MCP Server - Build Specification

## Overview

Build an MCP (Model Context Protocol) server that provides semantic search and retrieval of OpenZeppelin Contracts documentation. The server should pre-index documentation at build time and expose tools for querying contract APIs, searching docs, and retrieving specific contract information.

## Goals

1. **Fast lookups** - No runtime crawling, pre-built index
2. **Offline capable** - Works without internet after initial build
3. **Minimal dependencies** - No external services (no Qdrant, no OpenAI API for embeddings)
4. **Contract-aware** - Understands Solidity structure (functions, events, modifiers, errors)
5. **Version aware** - Supports multiple OZ versions (4.x, 5.x)

## Technology Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Search**: SQLite with FTS5 (full-text search)
- **Optional embeddings**: `@xenova/transformers` for local vector search (no API needed)
- **Build tool**: tsup or esbuild

## Project Structure

```
openzeppelin-docs-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── server.ts             # MCP server implementation
│   ├── tools/
│   │   ├── search.ts         # search_oz_docs tool
│   │   ├── get-contract.ts   # get_oz_contract tool
│   │   ├── get-function.ts   # get_oz_function tool
│   │   └── list-modules.ts   # list_oz_modules tool
│   ├── indexer/
│   │   ├── fetch-docs.ts     # Fetches docs from GitHub
│   │   ├── parse-mdx.ts      # Parses MDX files
│   │   ├── parse-solidity.ts # Extracts NatSpec from .sol files
│   │   └── build-index.ts    # Builds SQLite FTS index
│   ├── db/
│   │   ├── schema.ts         # SQLite schema
│   │   └── queries.ts        # Search queries
│   └── types.ts              # TypeScript types
├── scripts/
│   └── build-index.ts        # CLI script to build/rebuild index
├── data/
│   └── oz-docs.db            # Pre-built SQLite database (gitignored, built on install)
└── README.md
```

## Database Schema

```sql
-- Main documentation chunks
CREATE TABLE docs (
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
CREATE TABLE contracts (
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
CREATE TABLE members (
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

-- FTS virtual tables
CREATE VIRTUAL TABLE docs_fts USING fts5(
    title, content, module, category,
    content='docs',
    content_rowid='id'
);

CREATE VIRTUAL TABLE members_fts USING fts5(
    name, signature, natspec_notice, natspec_dev,
    content='members',
    content_rowid='id'
);
```

## MCP Tools to Implement

### 1. `search_oz_docs`

Search across all OpenZeppelin documentation.

```typescript
{
  name: "search_oz_docs",
  description: "Search OpenZeppelin Contracts documentation for guides, API references, and code examples",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query (e.g., 'reentrancy guard', 'ERC20 approve', 'access control roles')"
      },
      version: {
        type: "string",
        enum: ["4.x", "5.x", "all"],
        default: "5.x",
        description: "OpenZeppelin Contracts version"
      },
      category: {
        type: "string",
        enum: ["access", "token", "utils", "governance", "proxy", "finance", "metatx", "all"],
        default: "all",
        description: "Filter by category"
      },
      limit: {
        type: "number",
        default: 5,
        description: "Max results to return"
      }
    },
    required: ["query"]
  }
}
```

**Returns**: Array of matching documentation chunks with relevance scores, snippets, and source URLs.

### 2. `get_oz_contract`

Get detailed information about a specific contract or library.

```typescript
{
  name: "get_oz_contract",
  description: "Get detailed API reference for a specific OpenZeppelin contract or library",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Contract or library name (e.g., 'ERC20', 'Ownable', 'ECDSA', 'SafeERC20')"
      },
      version: {
        type: "string",
        enum: ["4.x", "5.x"],
        default: "5.x"
      }
    },
    required: ["name"]
  }
}
```

**Returns**: Contract metadata, inheritance chain, all functions/events/errors with full signatures and NatSpec.

### 3. `get_oz_function`

Get detailed information about a specific function.

```typescript
{
  name: "get_oz_function",
  description: "Get detailed information about a specific function in OpenZeppelin Contracts",
  inputSchema: {
    type: "object",
    properties: {
      function_name: {
        type: "string",
        description: "Function name, optionally with contract (e.g., 'transfer', 'ERC20.transfer', 'ECDSA.recover')"
      },
      version: {
        type: "string",
        enum: ["4.x", "5.x"],
        default: "5.x"
      }
    },
    required: ["function_name"]
  }
}
```

**Returns**: Function signature, parameters with types and descriptions, return values, NatSpec documentation, usage examples if available.

### 4. `list_oz_modules`

List available modules/contracts by category.

```typescript
{
  name: "list_oz_modules",
  description: "List all available OpenZeppelin contracts and libraries, optionally filtered by category",
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["access", "token", "utils", "governance", "proxy", "finance", "metatx", "all"],
        default: "all"
      },
      version: {
        type: "string",
        enum: ["4.x", "5.x"],
        default: "5.x"
      }
    }
  }
}
```

**Returns**: Structured list of all contracts/libraries with brief descriptions.

## Data Sources to Index

### 1. OpenZeppelin Docs Repository

```
https://github.com/OpenZeppelin/docs
```

Clone and parse:

- `content/contracts/5.x/` - v5 guides and API docs (MDX format)
- `content/contracts/4.x/` - v4 guides and API docs (MDX format)

### 2. OpenZeppelin Contracts Source (for NatSpec)

```
https://github.com/OpenZeppelin/openzeppelin-contracts
```

Parse Solidity files to extract:

- NatSpec comments (@notice, @dev, @param, @return)
- Function signatures
- Events, errors, modifiers
- Inheritance relationships

Focus on:

- `contracts/access/` - AccessControl, Ownable, etc.
- `contracts/token/` - ERC20, ERC721, ERC1155, etc.
- `contracts/utils/` - ECDSA, MerkleProof, ReentrancyGuard, etc.
- `contracts/governance/` - Governor, Timelock, etc.
- `contracts/proxy/` - Proxy patterns, upgradeable

## Indexer Implementation Notes

### Fetching Docs

```typescript
// Use simple-git or degit to clone repos
// Or fetch raw files via GitHub API/raw URLs

import { simpleGit } from "simple-git";

async function fetchDocs(targetDir: string) {
  const git = simpleGit();

  // Clone docs repo (shallow)
  await git.clone(
    "https://github.com/OpenZeppelin/docs.git",
    `${targetDir}/docs`,
    ["--depth", "1"]
  );

  // Clone contracts repo for NatSpec (specific tags)
  await git.clone(
    "https://github.com/OpenZeppelin/openzeppelin-contracts.git",
    `${targetDir}/contracts-v5`,
    ["--depth", "1", "--branch", "v5.0.0"]
  );
}
```

### Parsing MDX

```typescript
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import { visit } from "unist-util-visit";

interface DocChunk {
  title: string;
  content: string;
  category: string;
  module: string;
  headingLevel: number;
}

function parseMdx(content: string, filePath: string): DocChunk[] {
  const chunks: DocChunk[] = [];
  // Parse MDX, split by headings, extract code blocks
  // Group related content together
  return chunks;
}
```

### Parsing Solidity NatSpec

```typescript
// Use solc or a lighter parser like solidity-parser-antlr

import { parse } from "@solidity-parser/parser";

interface ContractInfo {
  name: string;
  type: "contract" | "library" | "interface" | "abstract";
  inheritance: string[];
  functions: FunctionInfo[];
  events: EventInfo[];
  errors: ErrorInfo[];
}

function parseSolidity(source: string): ContractInfo[] {
  const ast = parse(source, { loc: true, range: true });
  // Extract contract definitions, functions, NatSpec
  return [];
}
```

### Building the Index

```typescript
import Database from "better-sqlite3";

async function buildIndex(docsDir: string, dbPath: string) {
  const db = new Database(dbPath);

  // Create schema
  db.exec(SCHEMA_SQL);

  // Index MDX docs
  const mdxFiles = glob.sync(`${docsDir}/docs/content/contracts/**/*.mdx`);
  for (const file of mdxFiles) {
    const chunks = parseMdx(await fs.readFile(file, "utf-8"), file);
    insertDocs(db, chunks);
  }

  // Index Solidity NatSpec
  const solFiles = glob.sync(`${docsDir}/contracts-v5/contracts/**/*.sol`);
  for (const file of solFiles) {
    const contracts = parseSolidity(await fs.readFile(file, "utf-8"));
    insertContracts(db, contracts);
  }

  // Rebuild FTS indexes
  db.exec(`INSERT INTO docs_fts(docs_fts) VALUES('rebuild')`);
  db.exec(`INSERT INTO members_fts(members_fts) VALUES('rebuild')`);
}
```

## MCP Server Implementation

```typescript
// src/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";

const db = new Database("./data/oz-docs.db", { readonly: true });

const server = new Server(
  { name: "openzeppelin-docs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    searchOzDocsTool,
    getOzContractTool,
    getOzFunctionTool,
    listOzModulesTool,
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "search_oz_docs":
      return searchOzDocs(args);
    case "get_oz_contract":
      return getOzContract(args);
    case "get_oz_function":
      return getOzFunction(args);
    case "list_oz_modules":
      return listOzModules(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Search Implementation

```typescript
// src/db/queries.ts

export function searchDocs(
  db: Database,
  query: string,
  version: string,
  category: string,
  limit: number
) {
  // Use FTS5 with BM25 ranking
  const sql = `
    SELECT 
      d.id,
      d.title,
      d.module,
      d.category,
      d.source_url,
      snippet(docs_fts, 1, '<mark>', '</mark>', '...', 32) as snippet,
      bm25(docs_fts) as rank
    FROM docs_fts
    JOIN docs d ON docs_fts.rowid = d.id
    WHERE docs_fts MATCH ?
      AND (? = 'all' OR d.version = ?)
      AND (? = 'all' OR d.category = ?)
    ORDER BY rank
    LIMIT ?
  `;

  // FTS5 query syntax: convert natural language to FTS query
  const ftsQuery = toFtsQuery(query);

  return db
    .prepare(sql)
    .all(ftsQuery, version, version, category, category, limit);
}

function toFtsQuery(query: string): string {
  // Handle special cases, add prefix matching for partial words
  // "ERC20 transfer" -> "ERC20* transfer*"
  return query
    .split(/\s+/)
    .map((term) => `${term}*`)
    .join(" ");
}
```

## Package.json

```json
{
  "name": "openzeppelin-docs-mcp",
  "version": "1.0.0",
  "description": "MCP server for OpenZeppelin Contracts documentation",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "oz-docs-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "build:index": "tsx scripts/build-index.ts",
    "postinstall": "npm run build:index",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "glob": "^10.0.0"
  },
  "devDependencies": {
    "@solidity-parser/parser": "^0.18.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^20.0.0",
    "remark-mdx": "^3.0.0",
    "remark-parse": "^11.0.0",
    "simple-git": "^3.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "unified": "^11.0.0",
    "unist-util-visit": "^5.0.0"
  }
}
```

## Claude Code Configuration

After building, add to Claude Code's MCP config:

```json
{
  "mcpServers": {
    "openzeppelin-docs": {
      "command": "node",
      "args": ["/path/to/openzeppelin-docs-mcp/dist/index.js"]
    }
  }
}
```

Or if published to npm:

```json
{
  "mcpServers": {
    "openzeppelin-docs": {
      "command": "npx",
      "args": ["-y", "openzeppelin-docs-mcp"]
    }
  }
}
```

## Build Steps Summary

1. **Initialize project**: `npm init`, install dependencies
2. **Create database schema**: SQLite with FTS5
3. **Build indexer**:
   - Fetch docs from GitHub
   - Parse MDX files for guides/API docs
   - Parse Solidity files for NatSpec
   - Populate database
4. **Implement MCP server**: Tools for search, contract lookup, function lookup
5. **Test locally**: Use MCP inspector or Claude Code
6. **Package for distribution**: npm publish or local install

## Testing

Use the MCP inspector to test:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Example queries to test:

- `search_oz_docs({ query: "reentrancy" })`
- `get_oz_contract({ name: "ERC20" })`
- `get_oz_function({ function_name: "ECDSA.recover" })`
- `list_oz_modules({ category: "utils" })`

## Future Enhancements

1. **Local embeddings**: Add optional semantic search using `@xenova/transformers` with `all-MiniLM-L6-v2`
2. **Version diffing**: Tool to compare API changes between versions
3. **Code generation**: Generate usage examples based on context
4. **Auto-update**: Watch for new OZ releases and re-index
5. **Upgradeable contracts**: Special handling for upgrade patterns
