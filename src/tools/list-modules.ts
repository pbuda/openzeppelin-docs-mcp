import type Database from 'better-sqlite3';
import { listModules, getCategories } from '../db/queries.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const listOzModulesTool: Tool = {
  name: 'list_oz_modules',
  description: 'List all available OpenZeppelin contracts and libraries, optionally filtered by category',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['access', 'token', 'utils', 'governance', 'proxy', 'finance', 'metatx', 'all'],
        default: 'all',
        description: 'Filter by category',
      },
      version: {
        type: 'string',
        enum: ['4.x', '5.x'],
        default: '5.x',
        description: 'OpenZeppelin Contracts version',
      },
    },
  },
};

export interface ListOzModulesArgs {
  category?: string;
  version?: string;
}

export function handleListOzModules(db: Database.Database, args: ListOzModulesArgs) {
  const { category = 'all', version = '5.x' } = args;

  const modules = listModules(db, category, version);
  const categories = getCategories(db, version);

  // Group by category
  const grouped: Record<string, Array<{
    name: string;
    type: string;
    description: string | null;
  }>> = {};

  for (const module of modules) {
    if (!grouped[module.category]) {
      grouped[module.category] = [];
    }
    grouped[module.category].push({
      name: module.name,
      type: module.type,
      description: module.description,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            version,
            filter: category,
            categories: categories.map(c => ({
              name: c.category,
              count: c.count,
            })),
            modules: grouped,
            totalCount: modules.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
