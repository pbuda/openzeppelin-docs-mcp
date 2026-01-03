import type Database from 'better-sqlite3';
import type {
  SearchResult,
  ContractDetails,
  MemberDetails,
  ParamInfo,
  ReturnInfo,
} from '../types.js';

/**
 * Convert natural language query to FTS5 syntax
 */
export function toFtsQuery(query: string): string {
  // Split by spaces, add prefix matching for partial words
  return query
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(term => `"${term}"*`)
    .join(' ');
}

/**
 * Search documentation using FTS5 with BM25 ranking
 */
export function searchDocs(
  db: Database.Database,
  query: string,
  version: string = '5.x',
  category: string = 'all',
  limit: number = 5
): SearchResult[] {
  const ftsQuery = toFtsQuery(query);

  const sql = `
    SELECT
      d.id,
      d.title,
      d.module,
      d.category,
      d.version,
      d.source_url as sourceUrl,
      snippet(docs_fts, 1, '**', '**', '...', 40) as snippet,
      bm25(docs_fts, 1.0, 2.0, 1.0, 1.0) as rank
    FROM docs_fts
    JOIN docs d ON docs_fts.rowid = d.id
    WHERE docs_fts MATCH ?
      AND (? = 'all' OR d.version = ?)
      AND (? = 'all' OR d.category = ?)
    ORDER BY rank
    LIMIT ?
  `;

  try {
    return db.prepare(sql).all(ftsQuery, version, version, category, category, limit) as SearchResult[];
  } catch (error) {
    // FTS query might fail for certain inputs, return empty results
    console.error('FTS search error:', error);
    return [];
  }
}

/**
 * Search members (functions, events, errors) using FTS5
 */
export function searchMembers(
  db: Database.Database,
  query: string,
  version: string = '5.x',
  limit: number = 10
): MemberDetails[] {
  const ftsQuery = toFtsQuery(query);

  const sql = `
    SELECT
      m.id,
      m.name,
      m.type,
      m.signature,
      m.visibility,
      m.mutability,
      m.params,
      m.returns,
      m.natspec_notice as natspecNotice,
      m.natspec_dev as natspecDev,
      m.example_code as exampleCode,
      c.name as contractName,
      c.version
    FROM members_fts
    JOIN members m ON members_fts.rowid = m.id
    JOIN contracts c ON m.contract_id = c.id
    WHERE members_fts MATCH ?
      AND (? = 'all' OR c.version = ?)
    ORDER BY bm25(members_fts)
    LIMIT ?
  `;

  try {
    const rows = db.prepare(sql).all(ftsQuery, version, version, limit) as Array<{
      id: number;
      name: string;
      type: string;
      signature: string;
      visibility: string | null;
      mutability: string | null;
      params: string;
      returns: string;
      natspecNotice: string | null;
      natspecDev: string | null;
      exampleCode: string | null;
      contractName: string;
      version: string;
    }>;

    return rows.map(row => ({
      name: row.name,
      type: row.type,
      signature: row.signature,
      visibility: row.visibility,
      mutability: row.mutability,
      params: JSON.parse(row.params) as ParamInfo[],
      returns: JSON.parse(row.returns) as ReturnInfo[],
      natspecNotice: row.natspecNotice,
      natspecDev: row.natspecDev,
      exampleCode: row.exampleCode,
    }));
  } catch (error) {
    console.error('FTS search error:', error);
    return [];
  }
}

/**
 * Get contract with all its members
 */
export function getContract(
  db: Database.Database,
  name: string,
  version: string = '5.x'
): ContractDetails | null {
  const contractSql = `
    SELECT
      id,
      name,
      type,
      category,
      version,
      inheritance,
      natspec_notice as natspecNotice,
      source_url as sourceUrl
    FROM contracts
    WHERE name = ? AND version = ?
  `;

  const contract = db.prepare(contractSql).get(name, version) as {
    id: number;
    name: string;
    type: string;
    category: string;
    version: string;
    inheritance: string;
    natspecNotice: string | null;
    sourceUrl: string | null;
  } | undefined;

  if (!contract) {
    // Try case-insensitive search
    const fuzzyContract = db.prepare(`
      SELECT
        id,
        name,
        type,
        category,
        version,
        inheritance,
        natspec_notice as natspecNotice,
        source_url as sourceUrl
      FROM contracts
      WHERE LOWER(name) = LOWER(?) AND version = ?
    `).get(name, version) as typeof contract;

    if (!fuzzyContract) {
      return null;
    }

    return buildContractDetails(db, fuzzyContract);
  }

  return buildContractDetails(db, contract);
}

function buildContractDetails(
  db: Database.Database,
  contract: {
    id: number;
    name: string;
    type: string;
    category: string;
    version: string;
    inheritance: string;
    natspecNotice: string | null;
    sourceUrl: string | null;
  }
): ContractDetails {
  const membersSql = `
    SELECT
      name,
      type,
      signature,
      visibility,
      mutability,
      params,
      returns,
      natspec_notice as natspecNotice,
      natspec_dev as natspecDev,
      example_code as exampleCode
    FROM members
    WHERE contract_id = ?
    ORDER BY type, name
  `;

  const members = db.prepare(membersSql).all(contract.id) as Array<{
    name: string;
    type: string;
    signature: string;
    visibility: string | null;
    mutability: string | null;
    params: string;
    returns: string;
    natspecNotice: string | null;
    natspecDev: string | null;
    exampleCode: string | null;
  }>;

  const functions: MemberDetails[] = [];
  const events: MemberDetails[] = [];
  const errors: MemberDetails[] = [];
  const modifiers: MemberDetails[] = [];

  for (const member of members) {
    const detail: MemberDetails = {
      name: member.name,
      type: member.type,
      signature: member.signature,
      visibility: member.visibility,
      mutability: member.mutability,
      params: JSON.parse(member.params),
      returns: JSON.parse(member.returns),
      natspecNotice: member.natspecNotice,
      natspecDev: member.natspecDev,
      exampleCode: member.exampleCode,
    };

    switch (member.type) {
      case 'function':
        functions.push(detail);
        break;
      case 'event':
        events.push(detail);
        break;
      case 'error':
        errors.push(detail);
        break;
      case 'modifier':
        modifiers.push(detail);
        break;
    }
  }

  return {
    name: contract.name,
    type: contract.type,
    category: contract.category,
    version: contract.version,
    inheritance: JSON.parse(contract.inheritance),
    natspecNotice: contract.natspecNotice,
    sourceUrl: contract.sourceUrl,
    functions,
    events,
    errors,
    modifiers,
  };
}

/**
 * Get function details, optionally filtered by contract name
 */
export function getFunction(
  db: Database.Database,
  functionName: string,
  contractName?: string,
  version: string = '5.x'
): MemberDetails[] {
  // Handle "Contract.function" format
  if (functionName.includes('.') && !contractName) {
    const parts = functionName.split('.');
    contractName = parts[0];
    functionName = parts[1];
  }

  let sql: string;
  let params: (string | undefined)[];

  if (contractName) {
    sql = `
      SELECT
        m.name,
        m.type,
        m.signature,
        m.visibility,
        m.mutability,
        m.params,
        m.returns,
        m.natspec_notice as natspecNotice,
        m.natspec_dev as natspecDev,
        m.example_code as exampleCode,
        c.name as contractName
      FROM members m
      JOIN contracts c ON m.contract_id = c.id
      WHERE m.name = ? AND c.name = ? AND c.version = ? AND m.type = 'function'
    `;
    params = [functionName, contractName, version];
  } else {
    sql = `
      SELECT
        m.name,
        m.type,
        m.signature,
        m.visibility,
        m.mutability,
        m.params,
        m.returns,
        m.natspec_notice as natspecNotice,
        m.natspec_dev as natspecDev,
        m.example_code as exampleCode,
        c.name as contractName
      FROM members m
      JOIN contracts c ON m.contract_id = c.id
      WHERE m.name = ? AND c.version = ? AND m.type = 'function'
    `;
    params = [functionName, version];
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    name: string;
    type: string;
    signature: string;
    visibility: string | null;
    mutability: string | null;
    params: string;
    returns: string;
    natspecNotice: string | null;
    natspecDev: string | null;
    exampleCode: string | null;
    contractName: string;
  }>;

  return rows.map(row => ({
    name: row.name,
    type: row.type,
    signature: row.signature,
    visibility: row.visibility,
    mutability: row.mutability,
    params: JSON.parse(row.params),
    returns: JSON.parse(row.returns),
    natspecNotice: row.natspecNotice,
    natspecDev: row.natspecDev,
    exampleCode: row.exampleCode,
  }));
}

/**
 * List all contracts/libraries, optionally filtered by category
 */
export function listModules(
  db: Database.Database,
  category: string = 'all',
  version: string = '5.x'
): Array<{
  name: string;
  type: string;
  category: string;
  description: string | null;
}> {
  const sql = `
    SELECT
      name,
      type,
      category,
      natspec_notice as description
    FROM contracts
    WHERE version = ?
      AND (? = 'all' OR category = ?)
    ORDER BY category, name
  `;

  return db.prepare(sql).all(version, category, category) as Array<{
    name: string;
    type: string;
    category: string;
    description: string | null;
  }>;
}

/**
 * Get all categories with counts
 */
export function getCategories(
  db: Database.Database,
  version: string = '5.x'
): Array<{ category: string; count: number }> {
  const sql = `
    SELECT category, COUNT(*) as count
    FROM contracts
    WHERE version = ?
    GROUP BY category
    ORDER BY count DESC
  `;

  return db.prepare(sql).all(version) as Array<{ category: string; count: number }>;
}
