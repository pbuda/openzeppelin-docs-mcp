# Claude Code Prompt: Build OpenZeppelin Docs MCP Server

Copy this entire prompt into Claude Code to start building:

---

## Task

Build an MCP server that indexes and searches OpenZeppelin Contracts documentation. The server should work offline after initial setup (no external APIs required at runtime).

## Specification

Read the full specification at: `./openzeppelin-mcp-spec.md` (I'll provide this file)

## Step-by-Step Implementation Order

### Phase 1: Project Setup

1. Create new directory `openzeppelin-docs-mcp`
2. Initialize with `package.json` (type: module, Node 20+)
3. Install core dependencies:
   - `@modelcontextprotocol/sdk` - MCP protocol
   - `better-sqlite3` - Database
   - `glob` - File discovery
4. Install dev dependencies:
   - `@solidity-parser/parser` - Parse Solidity NatSpec
   - `unified`, `remark-parse`, `remark-mdx`, `unist-util-visit` - Parse MDX
   - `simple-git` - Clone repos
   - `tsx`, `tsup`, `typescript`, types
5. Create `tsconfig.json` (ESM, strict mode)

### Phase 2: Database Schema

Create `src/db/schema.ts`:
- `docs` table: id, version, category, module, title, content, source_type, source_url
- `contracts` table: id, version, name, type, category, inheritance (JSON), natspec_notice
- `members` table: id, contract_id, name, type, signature, visibility, params (JSON), returns (JSON), natspec
- FTS5 virtual tables for full-text search on docs and members

### Phase 3: Indexer - Fetch Docs

Create `src/indexer/fetch-docs.ts`:
- Clone `https://github.com/OpenZeppelin/docs.git` (shallow)
- Clone `https://github.com/OpenZeppelin/openzeppelin-contracts.git` at tag v5.3.0 (shallow)
- Clone same repo at tag v4.9.6 for v4 docs
- Save to `./data/repos/`

### Phase 4: Indexer - Parse MDX

Create `src/indexer/parse-mdx.ts`:
- Parse MDX files from `docs/content/contracts/5.x/` and `4.x/`
- Extract: title (from frontmatter or first h1), content chunks split by h2/h3
- Detect category from file path (api/access, api/token, api/utils, etc.)
- Extract code examples from fenced code blocks
- Return array of DocChunk objects

### Phase 5: Indexer - Parse Solidity

Create `src/indexer/parse-solidity.ts`:
- Use `@solidity-parser/parser` to parse .sol files
- Extract NatSpec comments (@notice, @dev, @param, @return)
- Extract function signatures, events, errors, modifiers
- Extract inheritance relationships
- Handle: contracts, libraries, interfaces, abstract contracts
- Return ContractInfo objects

### Phase 6: Indexer - Build Index

Create `src/indexer/build-index.ts` and `scripts/build-index.ts`:
- Create/recreate SQLite database at `./data/oz-docs.db`
- Process all MDX files → insert into docs table
- Process all .sol files → insert into contracts and members tables
- Rebuild FTS indexes
- Log progress and stats

### Phase 7: Database Queries

Create `src/db/queries.ts`:
- `searchDocs(query, version, category, limit)` - FTS5 search with BM25 ranking
- `getContract(name, version)` - Get contract with all members
- `getFunction(name, contractName?, version)` - Get function details
- `listModules(category, version)` - List contracts by category
- Helper: `toFtsQuery(query)` - Convert natural language to FTS5 syntax

### Phase 8: MCP Tools

Create tool implementations in `src/tools/`:

1. `search.ts` - `search_oz_docs` tool
   - Input: query (required), version (default "5.x"), category (default "all"), limit (default 5)
   - Returns: matches with title, snippet, relevance score, source_url

2. `get-contract.ts` - `get_oz_contract` tool
   - Input: name (required), version (default "5.x")
   - Returns: full contract info with all functions, events, errors

3. `get-function.ts` - `get_oz_function` tool
   - Input: function_name (required, can include contract like "ERC20.transfer"), version
   - Returns: signature, params, returns, natspec, usage examples

4. `list-modules.ts` - `list_oz_modules` tool
   - Input: category (optional), version (default "5.x")
   - Returns: organized list of all contracts/libraries

### Phase 9: MCP Server

Create `src/server.ts`:
- Initialize MCP Server with name "openzeppelin-docs"
- Register all 4 tools with schemas
- Handle tool calls, route to implementations
- Open SQLite database in readonly mode

Create `src/index.ts`:
- Import server
- Create StdioServerTransport
- Connect and run
- Add shebang for CLI usage

### Phase 10: Package & Test

1. Add build scripts to package.json:
   - `build`: tsup compilation
   - `build:index`: run indexer
   - `postinstall`: auto-build index on install
   
2. Test with MCP inspector:
   ```bash
   npx @modelcontextprotocol/inspector node dist/index.js
   ```

3. Test queries:
   - `search_oz_docs({ query: "reentrancy guard" })`
   - `get_oz_contract({ name: "ECDSA" })`
   - `get_oz_function({ function_name: "tryRecover" })`

## Key Implementation Details

### FTS5 Search Query

```typescript
function searchDocs(db: Database, query: string, version: string, category: string, limit: number) {
  const ftsQuery = query.split(/\s+/).map(t => `"${t}"*`).join(' ');
  
  return db.prepare(`
    SELECT d.*, snippet(docs_fts, 1, '**', '**', '...', 40) as snippet,
           bm25(docs_fts, 1.0, 2.0, 1.0, 1.0) as rank
    FROM docs_fts
    JOIN docs d ON docs_fts.rowid = d.id
    WHERE docs_fts MATCH ?
      AND (d.version = ? OR ? = 'all')
      AND (d.category = ? OR ? = 'all')
    ORDER BY rank
    LIMIT ?
  `).all(ftsQuery, version, version, category, category, limit);
}
```

### Solidity Parser Usage

```typescript
import { parse } from '@solidity-parser/parser';

const ast = parse(soliditySource, { 
  loc: true, 
  range: true,
  tolerant: true  // Don't fail on minor issues
});

// Walk AST to find ContractDefinition, FunctionDefinition, etc.
```

### MDX Parsing

```typescript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';

const tree = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .parse(mdxContent);

// Walk tree to find headings, paragraphs, code blocks
```

## File Categories Mapping

Map file paths to categories:
- `*/api/access/*` or `*/access/*` → "access"
- `*/api/token/*` or `*/token/*` → "token"  
- `*/api/utils/*` or `*/utils/*` → "utils"
- `*/api/governance/*` → "governance"
- `*/api/proxy/*` → "proxy"
- `*/api/finance/*` → "finance"
- `*/api/metatx/*` → "metatx"

## Expected Output

When complete, I should be able to:

1. Run `npm run build:index` to fetch and index all OZ docs
2. Run `npm run build` to compile TypeScript
3. Add to Claude Code config and use tools like:
   - "Search OZ docs for signature verification"
   - "Show me the ECDSA library API"
   - "What parameters does ERC20.transferFrom take?"

## Start Now

Begin with Phase 1. Create the project directory and initialize package.json. Ask me if you need clarification on any phase.