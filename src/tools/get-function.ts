import type { Database } from '../db/schema.js';
import { getFunction } from '../db/queries.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const getOzFunctionTool: Tool = {
  name: 'get_oz_function',
  description: 'Get detailed information about a specific function in OpenZeppelin Contracts',
  inputSchema: {
    type: 'object',
    properties: {
      function_name: {
        type: 'string',
        description: "Function name, optionally with contract (e.g., 'transfer', 'ERC20.transfer', 'ECDSA.recover')",
      },
      version: {
        type: 'string',
        enum: ['4.x', '5.x'],
        default: '5.x',
        description: 'OpenZeppelin Contracts version',
      },
    },
    required: ['function_name'],
  },
};

export interface GetOzFunctionArgs {
  function_name: string;
  version?: string;
}

export function handleGetOzFunction(db: Database, args: GetOzFunctionArgs) {
  const { function_name, version = '5.x' } = args;

  const functions = getFunction(db, function_name, undefined, version);

  if (functions.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: `Function '${function_name}' not found in OpenZeppelin Contracts ${version}`,
              suggestion: 'Try searching with search_oz_docs or use Contract.function format',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Format the function details
  const formatted = functions.map(f => ({
    name: f.name,
    signature: f.signature,
    visibility: f.visibility,
    mutability: f.mutability,
    description: f.natspecNotice,
    devNote: f.natspecDev,
    parameters: f.params.map(p => ({
      name: p.name,
      type: p.type,
      description: p.description,
    })),
    returns: f.returns.map(r => ({
      name: r.name,
      type: r.type,
      description: r.description,
    })),
    example: f.exampleCode,
  }));

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            functionName: function_name,
            version,
            matches: formatted,
            count: formatted.length,
          },
          null,
          2
        ),
      },
    ],
  };
}
