import type { Database } from '../db/schema.js';
import { getContract } from '../db/queries.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const getOzContractTool: Tool = {
  name: 'get_oz_contract',
  description: 'Get detailed API reference for a specific OpenZeppelin contract or library',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "Contract or library name (e.g., 'ERC20', 'Ownable', 'ECDSA', 'SafeERC20')",
      },
      version: {
        type: 'string',
        enum: ['4.x', '5.x'],
        default: '5.x',
        description: 'OpenZeppelin Contracts version',
      },
    },
    required: ['name'],
  },
};

export interface GetOzContractArgs {
  name: string;
  version?: string;
}

export function handleGetOzContract(db: Database, args: GetOzContractArgs) {
  const { name, version = '5.x' } = args;

  const contract = getContract(db, name, version);

  if (!contract) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              error: `Contract '${name}' not found in OpenZeppelin Contracts ${version}`,
              suggestion: 'Try using list_oz_modules to see available contracts',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Format the contract details
  const formatted = {
    name: contract.name,
    type: contract.type,
    category: contract.category,
    version: contract.version,
    description: contract.natspecNotice,
    inheritance: contract.inheritance,
    sourceUrl: contract.sourceUrl,
    functions: contract.functions.map(f => ({
      name: f.name,
      signature: f.signature,
      visibility: f.visibility,
      mutability: f.mutability,
      description: f.natspecNotice,
      params: f.params,
      returns: f.returns,
    })),
    events: contract.events.map(e => ({
      name: e.name,
      signature: e.signature,
      description: e.natspecNotice,
      params: e.params,
    })),
    errors: contract.errors.map(e => ({
      name: e.name,
      signature: e.signature,
      description: e.natspecNotice,
      params: e.params,
    })),
    modifiers: contract.modifiers.map(m => ({
      name: m.name,
      signature: m.signature,
      description: m.natspecNotice,
      params: m.params,
    })),
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(formatted, null, 2),
      },
    ],
  };
}
