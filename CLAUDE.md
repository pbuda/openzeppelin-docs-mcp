# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenZeppelin Docs MCP Server - An MCP (Model Context Protocol) server that provides offline search and retrieval of OpenZeppelin Contracts documentation. Pre-indexes documentation at build time using SQLite with FTS5 for full-text search.

## Commands

```bash
# Install dependencies
npm install

# Build the SQLite index (fetches repos and indexes docs)
npm run build:index

# Build the TypeScript project
npm run build

# Run in development mode
npm run dev

# Start the MCP server
npm start

# Build index with options
npx tsx scripts/build-index.ts --force      # Force re-clone repos
npx tsx scripts/build-index.ts --skip-fetch # Skip fetching, use existing repos
```

## Architecture

### Directory Structure
- `src/index.ts` - MCP server entry point (stdio transport)
- `src/server.ts` - MCP server implementation with tool handlers
- `src/tools/` - MCP tool implementations (search, get-contract, get-function, list-modules)
- `src/db/` - SQLite schema and query functions
- `src/indexer/` - Documentation fetching and parsing (MDX, Solidity NatSpec)
- `scripts/build-index.ts` - CLI script to build the search index
- `data/` - Generated at runtime; contains repos/ and oz-docs.db

### Data Flow
1. `build-index.ts` clones OpenZeppelin docs and contracts repos
2. `parse-mdx.ts` extracts documentation chunks from MDX files
3. `parse-solidity.ts` extracts NatSpec comments from Solidity contracts
4. Data is stored in SQLite with FTS5 virtual tables for full-text search
5. MCP server opens the database in readonly mode and handles tool calls

### MCP Tools
- `search_oz_docs` - Full-text search across docs and API references
- `get_oz_contract` - Get detailed contract/library API with all members
- `get_oz_function` - Get function details by name (supports Contract.function format)
- `list_oz_modules` - List available contracts grouped by category

### Key Dependencies
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `better-sqlite3` - SQLite with FTS5 support
- `@solidity-parser/parser` - Solidity AST parsing for NatSpec extraction
- `unified/remark-parse/remark-mdx` - MDX documentation parsing
- `simple-git` - Repository cloning

## Claude Code Configuration

After building, add to Claude Code's MCP config:
```json
{
  "mcpServers": {
    "openzeppelin-docs": {
      "command": "node",
      "args": ["/path/to/ozmcp/dist/index.js"]
    }
  }
}
```
