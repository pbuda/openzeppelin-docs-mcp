// Documentation chunk from MDX parsing
export interface DocChunk {
  title: string;
  content: string;
  category: string;
  module: string;
  version: string;
  sourceType: 'guide' | 'api' | 'natspec';
  sourceUrl?: string;
  filePath?: string;
}

// Contract information from Solidity parsing
export interface ContractInfo {
  name: string;
  type: 'contract' | 'library' | 'interface' | 'abstract';
  category: string;
  version: string;
  inheritance: string[];
  natspecNotice?: string;
  sourceUrl?: string;
  functions: FunctionInfo[];
  events: EventInfo[];
  errors: ErrorInfo[];
  modifiers: ModifierInfo[];
}

export interface FunctionInfo {
  name: string;
  signature: string;
  visibility: 'public' | 'external' | 'internal' | 'private';
  mutability: 'view' | 'pure' | 'payable' | '';
  params: ParamInfo[];
  returns: ReturnInfo[];
  natspecNotice?: string;
  natspecDev?: string;
  exampleCode?: string;
}

export interface EventInfo {
  name: string;
  signature: string;
  params: ParamInfo[];
  natspecNotice?: string;
  natspecDev?: string;
}

export interface ErrorInfo {
  name: string;
  signature: string;
  params: ParamInfo[];
  natspecNotice?: string;
  natspecDev?: string;
}

export interface ModifierInfo {
  name: string;
  signature: string;
  params: ParamInfo[];
  natspecNotice?: string;
  natspecDev?: string;
}

export interface ParamInfo {
  name: string;
  type: string;
  description?: string;
}

export interface ReturnInfo {
  name?: string;
  type: string;
  description?: string;
}

// Database row types
export interface DocRow {
  id: number;
  version: string;
  category: string;
  module: string;
  title: string;
  content: string;
  source_type: string;
  source_url: string | null;
  file_path: string | null;
}

export interface ContractRow {
  id: number;
  version: string;
  name: string;
  type: string;
  category: string;
  inheritance: string; // JSON
  natspec_notice: string | null;
  source_url: string | null;
}

export interface MemberRow {
  id: number;
  contract_id: number;
  name: string;
  type: string;
  signature: string;
  visibility: string | null;
  mutability: string | null;
  params: string; // JSON
  returns: string; // JSON
  natspec_notice: string | null;
  natspec_dev: string | null;
  example_code: string | null;
}

// Search result types
export interface SearchResult {
  id: number;
  title: string;
  module: string;
  category: string;
  version: string;
  sourceUrl: string | null;
  snippet: string;
  rank: number;
}

export interface ContractDetails {
  name: string;
  type: string;
  category: string;
  version: string;
  inheritance: string[];
  natspecNotice: string | null;
  sourceUrl: string | null;
  functions: MemberDetails[];
  events: MemberDetails[];
  errors: MemberDetails[];
  modifiers: MemberDetails[];
}

export interface MemberDetails {
  name: string;
  type: string;
  signature: string;
  visibility: string | null;
  mutability: string | null;
  params: ParamInfo[];
  returns: ReturnInfo[];
  natspecNotice: string | null;
  natspecDev: string | null;
  exampleCode: string | null;
}
