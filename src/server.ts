import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { searchOzDocsTool, handleSearchOzDocs, type SearchOzDocsArgs } from './tools/search.js';
import { getOzContractTool, handleGetOzContract, type GetOzContractArgs } from './tools/get-contract.js';
import { getOzFunctionTool, handleGetOzFunction, type GetOzFunctionArgs } from './tools/get-function.js';
import { listOzModulesTool, handleListOzModules, type ListOzModulesArgs } from './tools/list-modules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createServer(dbPath?: string): Server {
  // Resolve database path
  const resolvedDbPath = dbPath || path.resolve(__dirname, '..', 'data', 'oz-docs.db');

  // Open database in readonly mode
  let db: Database.Database;
  try {
    db = new Database(resolvedDbPath, { readonly: true });
  } catch (error) {
    console.error(`Failed to open database at ${resolvedDbPath}`);
    console.error('Run "npm run build:index" to build the database first.');
    throw error;
  }

  // Create MCP server
  const server = new Server(
    {
      name: 'openzeppelin-docs',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
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

    try {
      switch (name) {
        case 'search_oz_docs':
          return handleSearchOzDocs(db, args as unknown as SearchOzDocsArgs);

        case 'get_oz_contract':
          return handleGetOzContract(db, args as unknown as GetOzContractArgs);

        case 'get_oz_function':
          return handleGetOzFunction(db, args as unknown as GetOzFunctionArgs);

        case 'list_oz_modules':
          return handleListOzModules(db, args as unknown as ListOzModulesArgs);

        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  });

  // Clean up on close
  server.onclose = () => {
    db.close();
  };

  return server;
}
