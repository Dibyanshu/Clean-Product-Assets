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

const MOCK_SCHEMA: Array<{
  table: string;
  columns: Array<{ name: string; type: string; primary?: boolean; nullable?: boolean }>;
}> = [
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

const MOCK_FUNCTIONS = [
  {
    name: "get_user_by_email",
    parameters: "email TEXT",
    description: "Returns a single user row matching the provided email address.",
  },
  {
    name: "get_active_sessions",
    parameters: "user_id TEXT",
    description: "Returns all non-expired sessions for a given user.",
  },
  {
    name: "calculate_order_total",
    parameters: "order_id TEXT",
    description: "Sums unit_price * quantity for all items belonging to an order.",
  },
];

export async function extractSchema(projectId: string): Promise<ExtractResult> {
  logger.info({ projectId }, "[DBSchemaAgent] Starting schema extraction");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  await repo.deleteSchemaForProject(projectId);
  logger.info({ projectId }, "[DBSchemaAgent] Cleared existing schema");

  const extractedAt = new Date().toISOString();
  const tables: SchemaTable[] = [];

  for (const mock of MOCK_SCHEMA) {
    const tableId = crypto.randomUUID();
    await repo.insertTable({
      id: tableId,
      project_id: projectId,
      name: mock.table,
      extracted_at: extractedAt,
    });

    const columns: SchemaColumn[] = [];
    for (const col of mock.columns) {
      const colId = crypto.randomUUID();
      await repo.insertColumn({
        id: colId,
        table_id: tableId,
        name: col.name,
        type: col.type,
        is_primary: col.primary ? 1 : 0,
        is_nullable: col.nullable !== false ? 1 : 0,
      });
      columns.push({
        id: colId,
        name: col.name,
        type: col.type,
        is_primary: !!col.primary,
        is_nullable: col.nullable !== false,
      });
    }

    tables.push({ id: tableId, name: mock.table, columns, extracted_at: extractedAt });
  }

  const functions: SchemaFunction[] = [];
  for (const fn of MOCK_FUNCTIONS) {
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

  // --- Vector store: serialise schema to text and upsert ---
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
