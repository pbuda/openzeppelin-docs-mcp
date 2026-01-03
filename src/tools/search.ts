import type Database from 'better-sqlite3';
import { searchDocs, searchMembers } from '../db/queries.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const searchOzDocsTool: Tool = {
  name: 'search_oz_docs',
  description: 'Search OpenZeppelin Contracts documentation for guides, API references, and code examples',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: "Search query (e.g., 'reentrancy guard', 'ERC20 approve', 'access control roles')",
      },
      version: {
        type: 'string',
        enum: ['4.x', '5.x', 'all'],
        default: '5.x',
        description: 'OpenZeppelin Contracts version',
      },
      category: {
        type: 'string',
        enum: ['access', 'token', 'utils', 'governance', 'proxy', 'finance', 'metatx', 'all'],
        default: 'all',
        description: 'Filter by category',
      },
      limit: {
        type: 'number',
        default: 5,
        description: 'Max results to return',
      },
    },
    required: ['query'],
  },
};

export interface SearchOzDocsArgs {
  query: string;
  version?: string;
  category?: string;
  limit?: number;
}

export function handleSearchOzDocs(db: Database.Database, args: SearchOzDocsArgs) {
  const { query, version = '5.x', category = 'all', limit = 5 } = args;

  // Search documentation
  const docResults = searchDocs(db, query, version, category, limit);

  // Also search members (functions, events, etc.)
  const memberResults = searchMembers(db, query, version, Math.min(limit, 5));

  // Format results
  const formattedDocs = docResults.map(result => ({
    type: 'documentation',
    title: result.title,
    module: result.module,
    category: result.category,
    version: result.version,
    snippet: result.snippet,
    sourceUrl: result.sourceUrl,
    relevance: Math.abs(result.rank),
  }));

  const formattedMembers = memberResults.map(member => ({
    type: 'api',
    name: member.name,
    memberType: member.type,
    signature: member.signature,
    description: member.natspecNotice || member.natspecDev || null,
    visibility: member.visibility,
  }));

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            query,
            version,
            category,
            documentation: formattedDocs,
            api: formattedMembers,
            totalResults: formattedDocs.length + formattedMembers.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
