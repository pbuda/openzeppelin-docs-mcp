import { parse, visit } from '@solidity-parser/parser';
import type {
  ContractDefinition,
  FunctionDefinition,
  EventDefinition,
  ErrorDefinition,
  ModifierDefinition,
  VariableDeclaration,
  TypeName,
  SourceUnit,
} from '@solidity-parser/parser/dist/src/ast-types.js';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import type {
  ContractInfo,
  FunctionInfo,
  EventInfo,
  ErrorInfo,
  ModifierInfo,
  ParamInfo,
  ReturnInfo,
} from '../types.js';

// Category mapping from file paths
const CATEGORY_PATTERNS: Record<string, RegExp> = {
  access: /\/access\//,
  token: /\/token\//,
  utils: /\/utils\//,
  governance: /\/governance\//,
  proxy: /\/proxy\//,
  finance: /\/finance\//,
  metatx: /\/metatx\//,
  interfaces: /\/interfaces\//,
  crosschain: /\/crosschain\//,
  mocks: /\/mocks\//,
  vendor: /\/vendor\//,
};

interface NatSpecComment {
  notice?: string;
  dev?: string;
  params: Record<string, string>;
  returns: Record<string, string>;
  inheritdoc?: string;
}

export async function parseSolidityFiles(contractsDir: string, version: string): Promise<ContractInfo[]> {
  const contracts: ContractInfo[] = [];

  const pattern = path.join(contractsDir, 'contracts/**/*.sol');
  const files = await glob(pattern);

  console.log(`Found ${files.length} Solidity files in ${contractsDir}`);

  for (const filePath of files) {
    // Skip mocks and test files
    if (filePath.includes('/mocks/') || filePath.includes('/test/')) {
      continue;
    }

    try {
      const fileContracts = await parseSolidityFile(filePath, version);
      contracts.push(...fileContracts);
    } catch (error) {
      console.warn(`Warning: Failed to parse ${filePath}:`, error);
    }
  }

  return contracts;
}

export async function parseSolidityFile(filePath: string, version: string): Promise<ContractInfo[]> {
  const source = await fs.readFile(filePath, 'utf-8');
  const contracts: ContractInfo[] = [];

  let ast: SourceUnit;
  try {
    ast = parse(source, {
      loc: true,
      range: true,
      tolerant: true,
    }) as SourceUnit;
  } catch (error) {
    console.warn(`Parse error in ${filePath}:`, error);
    return [];
  }

  // Extract all NatSpec comments
  const natspecMap = extractNatSpecComments(source);

  visit(ast, {
    ContractDefinition: (node: ContractDefinition) => {
      const contract = parseContractDefinition(node, filePath, version, source, natspecMap);
      if (contract) {
        contracts.push(contract);
      }
    },
  });

  return contracts;
}

function parseContractDefinition(
  node: ContractDefinition,
  filePath: string,
  version: string,
  source: string,
  natspecMap: Map<number, NatSpecComment>
): ContractInfo | null {
  const category = detectCategory(filePath);

  // Get NatSpec for the contract itself
  const contractNatspec = findNatSpecBefore(node.loc?.start?.line || 0, natspecMap);

  const contract: ContractInfo = {
    name: node.name,
    type: getContractType(node),
    category,
    version,
    inheritance: node.baseContracts.map(base => {
      if (base.baseName.type === 'UserDefinedTypeName') {
        return base.baseName.namePath;
      }
      return '';
    }).filter(Boolean),
    natspecNotice: contractNatspec?.notice,
    sourceUrl: buildGitHubUrl(filePath, version),
    functions: [],
    events: [],
    errors: [],
    modifiers: [],
  };

  // Parse members
  for (const subNode of node.subNodes) {
    const memberNatspec = findNatSpecBefore(subNode.loc?.start?.line || 0, natspecMap);

    if (subNode.type === 'FunctionDefinition') {
      const funcInfo = parseFunctionDefinition(subNode, memberNatspec);
      if (funcInfo) {
        contract.functions.push(funcInfo);
      }
    } else if (subNode.type === 'EventDefinition') {
      const eventInfo = parseEventDefinition(subNode as EventDefinition, memberNatspec);
      if (eventInfo) {
        contract.events.push(eventInfo);
      }
    } else if (subNode.type === 'ErrorDefinition') {
      const errorInfo = parseErrorDefinition(subNode as ErrorDefinition, memberNatspec);
      if (errorInfo) {
        contract.errors.push(errorInfo);
      }
    } else if (subNode.type === 'ModifierDefinition') {
      const modifierInfo = parseModifierDefinition(subNode as ModifierDefinition, memberNatspec);
      if (modifierInfo) {
        contract.modifiers.push(modifierInfo);
      }
    }
  }

  return contract;
}

function parseFunctionDefinition(
  node: FunctionDefinition,
  natspec?: NatSpecComment
): FunctionInfo | null {
  // Skip constructor, fallback, receive for now (or handle them specially)
  const name = node.name || (node.isConstructor ? 'constructor' : node.isFallback ? 'fallback' : node.isReceiveEther ? 'receive' : '');
  if (!name) return null;

  const params: ParamInfo[] = (node.parameters || []).map(param => ({
    name: param.name || '',
    type: typeNameToString(param.typeName),
    description: natspec?.params[param.name || ''],
  }));

  const returns: ReturnInfo[] = (node.returnParameters || []).map((param, idx) => ({
    name: param.name || undefined,
    type: typeNameToString(param.typeName),
    description: natspec?.returns[param.name || `_${idx}`] || natspec?.returns[String(idx)],
  }));

  const signature = buildFunctionSignature(name, params, returns, node);

  return {
    name,
    signature,
    visibility: node.visibility || 'public',
    mutability: node.stateMutability || '',
    params,
    returns,
    natspecNotice: natspec?.notice,
    natspecDev: natspec?.dev,
  };
}

function parseEventDefinition(
  node: EventDefinition,
  natspec?: NatSpecComment
): EventInfo {
  const params: ParamInfo[] = (node.parameters || []).map(param => ({
    name: param.name || '',
    type: typeNameToString(param.typeName),
    description: natspec?.params[param.name || ''],
  }));

  const signature = `event ${node.name}(${params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')})`;

  return {
    name: node.name,
    signature,
    params,
    natspecNotice: natspec?.notice,
    natspecDev: natspec?.dev,
  };
}

function parseErrorDefinition(
  node: ErrorDefinition,
  natspec?: NatSpecComment
): ErrorInfo {
  const params: ParamInfo[] = (node.parameters || []).map(param => ({
    name: param.name || '',
    type: typeNameToString(param.typeName),
    description: natspec?.params[param.name || ''],
  }));

  const signature = `error ${node.name}(${params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')})`;

  return {
    name: node.name,
    signature,
    params,
    natspecNotice: natspec?.notice,
    natspecDev: natspec?.dev,
  };
}

function parseModifierDefinition(
  node: ModifierDefinition,
  natspec?: NatSpecComment
): ModifierInfo {
  const params: ParamInfo[] = (node.parameters || []).map(param => ({
    name: param.name || '',
    type: typeNameToString(param.typeName),
    description: natspec?.params[param.name || ''],
  }));

  const signature = `modifier ${node.name}(${params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ')})`;

  return {
    name: node.name || '',
    signature,
    params,
    natspecNotice: natspec?.notice,
    natspecDev: natspec?.dev,
  };
}

function extractNatSpecComments(source: string): Map<number, NatSpecComment> {
  const map = new Map<number, NatSpecComment>();
  const lines = source.split('\n');

  let currentComment: string[] = [];
  let inBlockComment = false;
  let commentEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Multi-line NatSpec comment
    if (trimmed.startsWith('/**')) {
      inBlockComment = true;
      currentComment = [trimmed.slice(3)];
    } else if (inBlockComment) {
      if (trimmed.endsWith('*/')) {
        currentComment.push(trimmed.slice(0, -2));
        inBlockComment = false;
        commentEndLine = i + 1; // 1-indexed

        const natspec = parseNatSpecContent(currentComment.join('\n'));
        if (natspec) {
          // Look for the next non-empty line (the definition)
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim()) {
              map.set(j + 1, natspec);
              break;
            }
          }
        }
        currentComment = [];
      } else {
        // Remove leading * if present
        const content = trimmed.startsWith('*') ? trimmed.slice(1).trim() : trimmed;
        currentComment.push(content);
      }
    }
    // Single line NatSpec
    else if (trimmed.startsWith('///')) {
      const content = trimmed.slice(3).trim();
      if (commentEndLine === i) {
        // Continue previous single-line comment block
        const prevNatspec = map.get(i + 1);
        if (prevNatspec) {
          const newNatspec = parseNatSpecContent(content);
          if (newNatspec) {
            // Merge
            if (newNatspec.notice) prevNatspec.notice = (prevNatspec.notice || '') + ' ' + newNatspec.notice;
            if (newNatspec.dev) prevNatspec.dev = (prevNatspec.dev || '') + ' ' + newNatspec.dev;
            Object.assign(prevNatspec.params, newNatspec.params);
            Object.assign(prevNatspec.returns, newNatspec.returns);
          }
        }
      } else {
        const natspec = parseNatSpecContent(content);
        if (natspec) {
          map.set(i + 2, natspec); // Next line
        }
      }
      commentEndLine = i + 1;
    }
  }

  return map;
}

function parseNatSpecContent(content: string): NatSpecComment | null {
  const natspec: NatSpecComment = {
    params: {},
    returns: {},
  };

  const lines = content.split('\n').map(l => l.trim()).filter(l => l);

  let currentTag = '';
  let currentContent = '';

  for (const line of lines) {
    if (line.startsWith('@notice')) {
      if (currentTag === 'notice') natspec.notice = (natspec.notice || '') + ' ' + currentContent;
      currentTag = 'notice';
      currentContent = line.slice(7).trim();
    } else if (line.startsWith('@dev')) {
      if (currentTag === 'dev') natspec.dev = (natspec.dev || '') + ' ' + currentContent;
      currentTag = 'dev';
      currentContent = line.slice(4).trim();
    } else if (line.startsWith('@param')) {
      const match = line.match(/@param\s+(\w+)\s+(.*)/);
      if (match) {
        natspec.params[match[1]] = match[2];
      }
      currentTag = 'param';
      currentContent = '';
    } else if (line.startsWith('@return')) {
      const match = line.match(/@return\s+(\w+)?\s*(.*)/);
      if (match) {
        const name = match[1] || Object.keys(natspec.returns).length.toString();
        natspec.returns[name] = match[2];
      }
      currentTag = 'return';
      currentContent = '';
    } else if (line.startsWith('@inheritdoc')) {
      natspec.inheritdoc = line.slice(11).trim();
      currentTag = 'inheritdoc';
      currentContent = '';
    } else if (line.startsWith('@')) {
      // Other tags, ignore for now
      currentTag = '';
      currentContent = '';
    } else if (currentTag && !line.startsWith('@')) {
      // Continue current content
      currentContent += ' ' + line;
    }
  }

  // Save final content
  if (currentTag === 'notice' && currentContent) {
    natspec.notice = (natspec.notice || '') + ' ' + currentContent;
  } else if (currentTag === 'dev' && currentContent) {
    natspec.dev = (natspec.dev || '') + ' ' + currentContent;
  }

  // Trim all values
  if (natspec.notice) natspec.notice = natspec.notice.trim();
  if (natspec.dev) natspec.dev = natspec.dev.trim();

  return Object.keys(natspec.params).length > 0 ||
         Object.keys(natspec.returns).length > 0 ||
         natspec.notice ||
         natspec.dev ||
         natspec.inheritdoc
    ? natspec
    : null;
}

function findNatSpecBefore(line: number, natspecMap: Map<number, NatSpecComment>): NatSpecComment | undefined {
  // Look for NatSpec on this line or the line before
  return natspecMap.get(line) || natspecMap.get(line - 1);
}

function getContractType(node: ContractDefinition): 'contract' | 'library' | 'interface' | 'abstract' {
  if (node.kind === 'library') return 'library';
  if (node.kind === 'interface') return 'interface';
  if (node.kind === 'abstract') return 'abstract';
  return 'contract';
}

function typeNameToString(typeName: TypeName | null): string {
  if (!typeName) return '';

  switch (typeName.type) {
    case 'ElementaryTypeName':
      return typeName.name;
    case 'UserDefinedTypeName':
      return typeName.namePath;
    case 'ArrayTypeName':
      const baseType = typeNameToString(typeName.baseTypeName);
      const length = typeName.length ? `[${typeName.length}]` : '[]';
      return baseType + length;
    case 'Mapping':
      const keyType = typeNameToString(typeName.keyType);
      const valueType = typeNameToString(typeName.valueType);
      return `mapping(${keyType} => ${valueType})`;
    case 'FunctionTypeName':
      return 'function';
    default:
      return 'unknown';
  }
}

function buildFunctionSignature(
  name: string,
  params: ParamInfo[],
  returns: ReturnInfo[],
  node: FunctionDefinition
): string {
  const paramsStr = params.map(p => `${p.type}${p.name ? ' ' + p.name : ''}`).join(', ');
  const visibility = node.visibility || 'public';
  const mutability = node.stateMutability ? ' ' + node.stateMutability : '';

  let sig = `function ${name}(${paramsStr})`;
  sig += ` ${visibility}`;
  if (mutability) sig += mutability;

  if (returns.length > 0) {
    const returnsStr = returns.map(r => r.type).join(', ');
    sig += ` returns (${returnsStr})`;
  }

  return sig;
}

function detectCategory(filePath: string): string {
  for (const [category, pattern] of Object.entries(CATEGORY_PATTERNS)) {
    if (pattern.test(filePath)) {
      return category;
    }
  }
  return 'general';
}

function buildGitHubUrl(filePath: string, version: string): string {
  // Extract relative path from contracts directory
  const match = filePath.match(/contracts-v\d+\/(contracts\/.+\.sol)$/);
  if (match) {
    const tag = version === '5.x' ? 'v5.3.0' : 'v4.9.6';
    return `https://github.com/OpenZeppelin/openzeppelin-contracts/blob/${tag}/${match[1]}`;
  }
  return '';
}
