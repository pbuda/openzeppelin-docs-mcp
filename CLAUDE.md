# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenZeppelin Docs MCP Server** (`openzeppelin-docs-mcp`) - An MCP (Model Context Protocol) server that provides offline search and retrieval of OpenZeppelin Contracts documentation for Claude Code and other MCP clients.

- **Repository**: https://github.com/pbuda/openzeppelin-docs-mcp
- **Runtime**: Node.js 20+, TypeScript, ESM modules
- **Database**: SQLite with FTS5 full-text search
- **Indexed content**: ~927 doc chunks, ~357 contracts, ~3000 members across OZ v4.x and v5.x

## Commands

```bash
# Install dependencies
npm install

# Build the SQLite index (clones OZ repos and indexes docs, ~2-3 min)
npm run build:index

# Build TypeScript to dist/
npm run build

# Run in development mode (hot reload)
npm run dev

# Start the MCP server
npm start

# Build index options
npx tsx scripts/build-index.ts --skip-fetch  # Use existing repos
npx tsx scripts/build-index.ts --force       # Force re-clone repos

# Test with MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js
```

## Architecture

```
src/
├── index.ts              # Entry point - stdio transport
├── server.ts             # MCP server, tool routing
├── types.ts              # TypeScript interfaces
├── db/
│   ├── schema.ts         # SQLite + FTS5 schema, triggers
│   └── queries.ts        # Search and retrieval functions
├── tools/
│   ├── search.ts         # search_oz_docs tool
│   ├── get-contract.ts   # get_oz_contract tool
│   ├── get-function.ts   # get_oz_function tool
│   └── list-modules.ts   # list_oz_modules tool
└── indexer/
    ├── fetch-docs.ts     # Git clone OZ repos
    ├── parse-mdx.ts      # MDX documentation parser
    ├── parse-solidity.ts # Solidity NatSpec extractor
    └── build-index.ts    # Orchestrates indexing

scripts/
└── build-index.ts        # CLI entry for npm run build:index

data/                     # Generated, gitignored
├── repos/                # Cloned OZ repositories
│   ├── docs/
│   ├── contracts-v5/
│   └── contracts-v4/
└── oz-docs.db            # SQLite database
```

## Data Flow

1. `fetch-docs.ts` - Shallow clones OpenZeppelin/docs and OpenZeppelin/openzeppelin-contracts (v5.3.0, v4.9.6)
2. `parse-mdx.ts` - Parses MDX files, extracts content chunks by heading
3. `parse-solidity.ts` - Parses .sol files, extracts NatSpec (@notice, @dev, @param, @return)
4. `build-index.ts` - Inserts into SQLite, FTS5 indexes auto-populate via triggers
5. `server.ts` - Opens DB readonly, handles MCP tool calls

## MCP Tools

| Tool | Purpose |
|------|---------|
| `search_oz_docs` | FTS5 search across docs and API members |
| `get_oz_contract` | Get contract with all functions/events/errors |
| `get_oz_function` | Get function details (supports `Contract.function` format) |
| `list_oz_modules` | List contracts grouped by category |

## Key Implementation Details

- **FTS5 queries**: Use `toFtsQuery()` in `queries.ts` to convert natural language to FTS5 syntax with prefix matching
- **NatSpec parsing**: Custom parser in `parse-solidity.ts` extracts comments before AST nodes by line number
- **Category detection**: File paths are matched against regex patterns to determine category (access, token, utils, etc.)
- **Version handling**: Data is tagged with version ("4.x" or "5.x"), queries default to "5.x"

## Database Schema

- `docs` - Documentation chunks (title, content, category, module, version)
- `contracts` - Contract metadata (name, type, inheritance, natspec)
- `members` - Functions/events/errors/modifiers (signature, params as JSON, natspec)
- `docs_fts` / `members_fts` - FTS5 virtual tables with auto-sync triggers

## Testing

```bash
# Test with MCP Inspector (interactive)
npx @modelcontextprotocol/inspector node dist/index.js

# Example tool calls to test:
# search_oz_docs({ query: "reentrancy" })
# get_oz_contract({ name: "ERC20" })
# get_oz_function({ function_name: "ECDSA.recover" })
# list_oz_modules({ category: "utils" })
```

## Distribution

```bash
# Publish to npm
npm login
npm publish

# Users install via:
claude mcp add --transport stdio openzeppelin-docs -- npx -y openzeppelin-docs-mcp

# Or from GitHub:
claude mcp add --transport stdio openzeppelin-docs -- npx -y github:pbuda/openzeppelin-docs-mcp
```

## Local Development with Claude Code

```bash
# Add local build to Claude Code
claude mcp add --transport stdio openzeppelin-docs -- node /home/pibu/dev/ozmcp/dist/index.js

# Remove if needed
claude mcp remove openzeppelin-docs
```
