import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

import { searchOzDocsTool, handleSearchOzDocs, type SearchOzDocsArgs } from './tools/search.js';
import { getOzContractTool, handleGetOzContract, type GetOzContractArgs } from './tools/get-contract.js';
import { getOzFunctionTool, handleGetOzFunction, type GetOzFunctionArgs } from './tools/get-function.js';
import { listOzModulesTool, handleListOzModules, type ListOzModulesArgs } from './tools/list-modules.js';
import { buildIndex } from './indexer/build-index.js';
import { openDatabase, type Database } from './db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Index status tracking
let indexStatus: 'ready' | 'building' | 'error' = 'ready';
let indexError: string | null = null;
let db: Database | null = null;

// Status tool definition
const indexStatusTool = {
  name: 'oz_index_status',
  description: 'Check if the OpenZeppelin docs index is ready. Call this if other tools report the index is building.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
};

function handleIndexStatus() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: indexStatus,
          error: indexError,
          message:
            indexStatus === 'building'
              ? 'Index is building. This takes 2-3 minutes on first run. Please wait and try again.'
              : indexStatus === 'error'
                ? `Index build failed: ${indexError}`
                : 'Index is ready.',
        }),
      },
    ],
  };
}

function createBuildingResponse(toolName: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'building',
          message: `Index is still building (2-3 minutes on first run). Please wait and call oz_index_status to check progress, then retry ${toolName}.`,
        }),
      },
    ],
  };
}

function createErrorResponse() {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          status: 'error',
          message: `Index build failed: ${indexError}. Try restarting the server or rebuilding manually.`,
        }),
      },
    ],
    isError: true,
  };
}

export function createServer(dbPath?: string): Server {
  // Resolve paths
  const dataDir = path.resolve(__dirname, '..', 'data');
  const resolvedDbPath = dbPath || path.join(dataDir, 'oz-docs.db');

  // Check if database exists
  if (existsSync(resolvedDbPath)) {
    // Database exists, open it asynchronously
    indexStatus = 'building'; // Temporarily set to building while we load
    openDatabase(resolvedDbPath)
      .then((database) => {
        db = database;
        indexStatus = 'ready';
      })
      .catch((error) => {
        indexStatus = 'error';
        indexError = error instanceof Error ? error.message : String(error);
      });
  } else {
    // Database doesn't exist, start background build
    indexStatus = 'building';
    console.error('Database not found. Building index in background (2-3 minutes)...');

    buildIndex({
      dataDir,
      dbPath: resolvedDbPath,
      skipFetch: false,
      force: false,
    })
      .then(() => {
        console.error('Index built successfully.');
        return openDatabase(resolvedDbPath);
      })
      .then((database) => {
        db = database;
        indexStatus = 'ready';
      })
      .catch((err) => {
        console.error('Index build failed:', err);
        indexStatus = 'error';
        indexError = err instanceof Error ? err.message : String(err);
      });
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
      indexStatusTool,
      searchOzDocsTool,
      getOzContractTool,
      getOzFunctionTool,
      listOzModulesTool,
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Status tool always works
    if (name === 'oz_index_status') {
      return handleIndexStatus();
    }

    // Other tools need the index to be ready
    if (indexStatus === 'building') {
      return createBuildingResponse(name);
    }

    if (indexStatus === 'error' || !db) {
      return createErrorResponse();
    }

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
    if (db) {
      db.close();
    }
  };

  return server;
}
