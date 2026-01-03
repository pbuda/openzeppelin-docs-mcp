# OpenZeppelin Docs MCP Server

An MCP (Model Context Protocol) server that provides offline search and retrieval of OpenZeppelin Contracts documentation. Pre-indexes documentation at build time using SQLite with FTS5 for fast full-text search.

## Features

- **Offline capable** - Works without internet after initial setup
- **Fast lookups** - Pre-built SQLite index with FTS5 full-text search
- **Contract-aware** - Understands Solidity structure (functions, events, modifiers, errors)
- **Version aware** - Supports OpenZeppelin Contracts v4.x and v5.x
- **NatSpec extraction** - Parses documentation directly from Solidity source files

## Installation

### Quick Install (GitHub)

```bash
claude mcp add --transport stdio openzeppelin-docs -- npx -y github:pbuda/openzeppelin-docs-mcp
```

The index will be built automatically on first run (~2-3 minutes).

### Install from npm

```bash
claude mcp add --transport stdio openzeppelin-docs -- npx -y openzeppelin-docs-mcp
```

### Verify Installation

```bash
# List configured servers
claude mcp list

# Check server status (inside Claude Code)
/mcp
```

## Building from Source

If you want to build and run locally:

```bash
# Clone the repository
git clone https://github.com/pbuda/openzeppelin-docs-mcp.git
cd openzeppelin-docs-mcp

# Install dependencies
npm install

# Build the documentation index (fetches repos, ~2-3 min)
npm run build:index

# Build TypeScript
npm run build
```

### Add Local Build to Claude Code

```bash
claude mcp add --transport stdio openzeppelin-docs -- node /absolute/path/to/openzeppelin-docs-mcp/dist/index.js
```

Or manually add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "openzeppelin-docs": {
      "command": "node",
      "args": ["/absolute/path/to/openzeppelin-docs-mcp/dist/index.js"]
    }
  }
}
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Available Tools

### `search_oz_docs`

Search OpenZeppelin Contracts documentation for guides, API references, and code examples.

```json
{
  "query": "reentrancy guard",
  "version": "5.x",
  "category": "all",
  "limit": 5
}
```

**Parameters:**
- `query` (required) - Search query (e.g., "ERC20 approve", "access control roles")
- `version` - `"4.x"`, `"5.x"`, or `"all"` (default: `"5.x"`)
- `category` - `"access"`, `"token"`, `"utils"`, `"governance"`, `"proxy"`, `"finance"`, `"metatx"`, or `"all"`
- `limit` - Max results (default: 5)

### `get_oz_contract`

Get detailed API reference for a specific contract or library.

```json
{
  "name": "ERC20",
  "version": "5.x"
}
```

**Parameters:**
- `name` (required) - Contract or library name (e.g., "Ownable", "ECDSA", "SafeERC20")
- `version` - `"4.x"` or `"5.x"` (default: `"5.x"`)

**Returns:** Contract metadata, inheritance chain, all functions/events/errors with signatures and NatSpec.

### `get_oz_function`

Get detailed information about a specific function.

```json
{
  "function_name": "ECDSA.recover",
  "version": "5.x"
}
```

**Parameters:**
- `function_name` (required) - Function name, optionally with contract (e.g., "transfer", "ERC20.transferFrom")
- `version` - `"4.x"` or `"5.x"` (default: `"5.x"`)

**Returns:** Function signature, parameters with types and descriptions, return values, NatSpec documentation.

### `list_oz_modules`

List all available contracts and libraries, optionally filtered by category.

```json
{
  "category": "utils",
  "version": "5.x"
}
```

**Parameters:**
- `category` - Filter by category or `"all"` (default: `"all"`)
- `version` - `"4.x"` or `"5.x"` (default: `"5.x"`)

**Returns:** Organized list of all contracts/libraries grouped by category.

## Development

```bash
# Run in development mode (with hot reload)
npm run dev

# Rebuild the index (skip fetching if repos exist)
npx tsx scripts/build-index.ts --skip-fetch

# Force re-clone repositories
npx tsx scripts/build-index.ts --force
```

## Data Sources

The indexer fetches and parses:

1. **OpenZeppelin Docs** - MDX documentation from [github.com/OpenZeppelin/docs](https://github.com/OpenZeppelin/docs)
2. **OpenZeppelin Contracts v5.3.0** - Solidity source with NatSpec comments
3. **OpenZeppelin Contracts v4.9.6** - Solidity source with NatSpec comments

## Database Statistics

After indexing:
- ~927 documentation chunks from MDX files
- ~357 contracts (191 v5.x, 166 v4.x)
- ~3,067 members (functions, events, modifiers)

## License

MIT
