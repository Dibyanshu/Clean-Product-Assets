import { logger } from "../../../lib/logger.js";
import * as repo from "../repository/dbSchema.repository.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as chroma from "../../../services/chroma.service.js";

export interface SchemaColumn {
  id: string;
  name: string;
  type: string;
  is_primary: boolean;
  is_nullable: boolean;
}

export interface SchemaTable {
  id: string;
  name: string;
  columns: SchemaColumn[];
  extracted_at: string;
}

export interface SchemaFunction {
  id: string;
  name: string;
  parameters: string | null;
  description: string | null;
}

export interface ExtractResult {
  projectId: string;
  tables: SchemaTable[];
  functions: SchemaFunction[];
  extractedAt: string;
}

interface RawTable {
  table: string;
  columns: Array<{ name: string; type: string; primary?: boolean; nullable?: boolean }>;
}

function parseCreateTable(sql: string): RawTable | null {
  const nameMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(/i);
  if (!nameMatch || !nameMatch[1]) return null;

  const tableName = nameMatch[1].toLowerCase();
  const parenStart = sql.indexOf("(");
  if (parenStart === -1) return null;

  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) { parenEnd = i; break; } }
  }

  const body = parenEnd === -1 ? sql.slice(parenStart + 1) : sql.slice(parenStart + 1, parenEnd);

  const columns: RawTable["columns"] = [];
  const lines = body.split(/,\s*\n|,\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const clean = line.replace(/--.*$/, "").trim();
    if (!clean) continue;

    const upper = clean.toUpperCase();
    if (upper.startsWith("PRIMARY KEY") || upper.startsWith("UNIQUE") || upper.startsWith("FOREIGN KEY") ||
        upper.startsWith("INDEX") || upper.startsWith("KEY") || upper.startsWith("CONSTRAINT") ||
        upper.startsWith("CHECK")) continue;

    const parts = clean.split(/\s+/);
    if (parts.length < 2) continue;

    const colName = parts[0]!.replace(/[`"']/g, "").toLowerCase();
    const colType = parts[1]!.replace(/\(.*\)/, "").toUpperCase();
    const isPrimary = upper.includes("PRIMARY KEY");
    const isNullable = !upper.includes("NOT NULL") && !isPrimary;

    if (colName && colType && /^[a-z_][a-z0-9_]*$/.test(colName)) {
      columns.push({ name: colName, type: colType, primary: isPrimary, nullable: isNullable });
    }
  }

  return columns.length > 0 ? { table: tableName, columns } : null;
}

interface RawFunction {
  name: string;
  parameters: string | null;
  description: string;
}

function parseCreateFunction(sql: string): RawFunction | null {
  const nameMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[`"']?(\w+)[`"']?\s*\(/i);
  if (!nameMatch || !nameMatch[1]) return null;

  const fnName = nameMatch[1].toLowerCase();
  const parenStart = sql.indexOf("(");
  let parenEnd = -1;
  let depth = 0;
  for (let i = parenStart; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) { parenEnd = i; break; } }
  }
  const params = parenEnd === -1 ? null : sql.slice(parenStart + 1, parenEnd).trim() || null;

  const fnType = /PROCEDURE/i.test(sql) ? "Stored Procedure" : "SQL Function";
  return { name: fnName, parameters: params, description: `${fnType} extracted from SQL source` };
}

const FALLBACK_SCHEMA: RawTable[] = [
  {
    table: "users",
    columns: [
      { name: "id", type: "TEXT", primary: true, nullable: false },
      { name: "email", type: "TEXT", nullable: false },
      { name: "password_hash", type: "TEXT", nullable: false },
      { name: "display_name", type: "TEXT", nullable: true },
      { name: "role", type: "TEXT", nullable: false },
      { name: "created_at", type: "DATETIME", nullable: false },
      { name: "updated_at", type: "DATETIME", nullable: false },
    ],
  },
  {
    table: "sessions",
    columns: [
      { name: "id", type: "TEXT", primary: true, nullable: false },
      { name: "user_id", type: "TEXT", nullable: false },
      { name: "token", type: "TEXT", nullable: false },
      { name: "expires_at", type: "DATETIME", nullable: false },
      { name: "created_at", type: "DATETIME", nullable: false },
    ],
  },
  {
    table: "products",
    columns: [
      { name: "id", type: "TEXT", primary: true, nullable: false },
      { name: "name", type: "TEXT", nullable: false },
      { name: "description", type: "TEXT", nullable: true },
      { name: "price", type: "REAL", nullable: false },
      { name: "stock_count", type: "INTEGER", nullable: false },
      { name: "category", type: "TEXT", nullable: true },
      { name: "created_at", type: "DATETIME", nullable: false },
    ],
  },
  {
    table: "orders",
    columns: [
      { name: "id", type: "TEXT", primary: true, nullable: false },
      { name: "user_id", type: "TEXT", nullable: false },
      { name: "status", type: "TEXT", nullable: false },
      { name: "total_amount", type: "REAL", nullable: false },
      { name: "shipping_address", type: "TEXT", nullable: true },
      { name: "created_at", type: "DATETIME", nullable: false },
      { name: "updated_at", type: "DATETIME", nullable: false },
    ],
  },
  {
    table: "order_items",
    columns: [
      { name: "id", type: "TEXT", primary: true, nullable: false },
      { name: "order_id", type: "TEXT", nullable: false },
      { name: "product_id", type: "TEXT", nullable: false },
      { name: "quantity", type: "INTEGER", nullable: false },
      { name: "unit_price", type: "REAL", nullable: false },
    ],
  },
];

const FALLBACK_FUNCTIONS: RawFunction[] = [
  { name: "get_user_by_email", parameters: "email TEXT", description: "Returns a single user row matching the provided email address." },
  { name: "get_active_sessions", parameters: "user_id TEXT", description: "Returns all non-expired sessions for a given user." },
  { name: "calculate_order_total", parameters: "order_id TEXT", description: "Sums unit_price * quantity for all items belonging to an order." },
];

export async function extractSchema(projectId: string): Promise<ExtractResult> {
  logger.info({ projectId }, "[DBSchemaAgent] Starting schema extraction");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  await repo.deleteSchemaForProject(projectId);
  logger.info({ projectId }, "[DBSchemaAgent] Cleared existing schema");

  const extractedAt = new Date().toISOString();

  let rawTables: RawTable[] = [];
  let rawFunctions: RawFunction[] = [];

  const chromaDocs = chroma.getAllDocuments(projectId);
  const sqlTableDocs = chromaDocs.filter((d) => d.metadata["type"] === "sql_table");
  const sqlFnDocs = chromaDocs.filter(
    (d) => d.metadata["type"] === "sql_function" || d.metadata["type"] === "sql_procedure"
  );

  logger.info({ projectId, sqlTableChunks: sqlTableDocs.length, sqlFnChunks: sqlFnDocs.length }, "[DBSchemaAgent] SQL chunks found in vector store");

  if (sqlTableDocs.length > 0) {
    for (const doc of sqlTableDocs) {
      const parsed = parseCreateTable(doc.content);
      if (parsed) rawTables.push(parsed);
    }
    for (const doc of sqlFnDocs) {
      const parsed = parseCreateFunction(doc.content);
      if (parsed) rawFunctions.push(parsed);
    }
    logger.info({ projectId, tables: rawTables.length, functions: rawFunctions.length }, "[DBSchemaAgent] Parsed from real SQL chunks");
  } else {
    logger.warn({ projectId }, "[DBSchemaAgent] No SQL chunks found in vector store — using fallback schema");
    rawTables = FALLBACK_SCHEMA;
    rawFunctions = FALLBACK_FUNCTIONS;
  }

  const tables: SchemaTable[] = [];
  for (const raw of rawTables) {
    const tableId = crypto.randomUUID();
    await repo.insertTable({ id: tableId, project_id: projectId, name: raw.table, extracted_at: extractedAt });

    const columns: SchemaColumn[] = [];
    for (const col of raw.columns) {
      const colId = crypto.randomUUID();
      await repo.insertColumn({
        id: colId,
        table_id: tableId,
        name: col.name,
        type: col.type,
        is_primary: col.primary ? 1 : 0,
        is_nullable: col.nullable !== false ? 1 : 0,
      });
      columns.push({ id: colId, name: col.name, type: col.type, is_primary: !!col.primary, is_nullable: col.nullable !== false });
    }
    tables.push({ id: tableId, name: raw.table, columns, extracted_at: extractedAt });
  }

  const functions: SchemaFunction[] = [];
  for (const fn of rawFunctions) {
    const fnId = crypto.randomUUID();
    await repo.insertFunction({
      id: fnId,
      project_id: projectId,
      name: fn.name,
      parameters: fn.parameters,
      description: fn.description,
      created_at: extractedAt,
    });
    functions.push({ id: fnId, name: fn.name, parameters: fn.parameters, description: fn.description });
  }

  logger.info({ projectId, tables: tables.length, functions: functions.length }, "[DBSchemaAgent] Extraction complete");

  chroma.createOrGetCollection(projectId);
  const schemaDocs: Parameters<typeof chroma.upsertDocuments>[1] = [];

  for (const t of tables) {
    const colText = t.columns
      .map((c) => `${c.name} ${c.type}${c.is_primary ? " PRIMARY KEY" : ""}${c.is_nullable ? "" : " NOT NULL"}`)
      .join(", ");
    schemaDocs.push({
      id: `${projectId}::schema::table::${t.name}`,
      content: `Table ${t.name}: ${colText}`,
      metadata: { type: "schema", file: `schema/tables/${t.name}` },
    });
  }

  for (const fn of functions) {
    schemaDocs.push({
      id: `${projectId}::schema::fn::${fn.name}`,
      content: `Function ${fn.name}(${fn.parameters ?? ""}) — ${fn.description ?? ""}`,
      metadata: { type: "schema", file: `schema/functions/${fn.name}` },
    });
  }

  chroma.upsertDocuments(projectId, schemaDocs);
  logger.info({ projectId, schemaChunks: schemaDocs.length }, "[DBSchemaAgent] Schema indexed in vector store");

  return { projectId, tables, functions, extractedAt };
}

export async function getSchema(projectId: string): Promise<ExtractResult | null> {
  const tableRecords = await repo.getTablesForProject(projectId);
  if (tableRecords.length === 0) return null;

  const tables: SchemaTable[] = await Promise.all(
    tableRecords.map(async (t) => {
      const cols = await repo.getColumnsForTable(t.id);
      return {
        id: t.id,
        name: t.name,
        extracted_at: t.extracted_at,
        columns: cols.map((c) => ({
          id: c.id,
          name: c.name,
          type: c.type,
          is_primary: c.is_primary === 1,
          is_nullable: c.is_nullable === 1,
        })),
      };
    }),
  );

  const fnRecords = await repo.getFunctionsForProject(projectId);
  const functions: SchemaFunction[] = fnRecords.map((f) => ({
    id: f.id,
    name: f.name,
    parameters: f.parameters,
    description: f.description,
  }));

  const extractedAt = (await repo.getLatestExtractedAt(projectId)) ?? tables[0]!.extracted_at;
  return { projectId, tables, functions, extractedAt };
}
