import { logger } from "../../../../lib/logger.js";
import * as repo from "../repository/dbSchema.repository.js";
import * as ingestionRepo from "../../../ingestion/repository/ingestion.repository.js";
import * as chroma from "../../../../services/chroma.service.js";
import { selectSqlSchemaChunks } from "../extractors/chunkSelector.service.js";
import { parseCreateFunction } from "../parsers/sqlFunction.parser.js";
import { parseForeignKeyRelationships } from "../parsers/sqlRelationship.parser.js";
import { parseCreateTable } from "../parsers/sqlTable.parser.js";
import { parseCreateView, parseQueryTableUsage } from "../parsers/sqlView.parser.js";
import { buildSchemaEmbeddingDocuments } from "../schemaEmbedding.service.js";
import type {
  ExtractResult,
  RawFunction,
  RawQueryTableUsage,
  RawRelationship,
  RawTable,
  RawView,
  SchemaColumn,
  SchemaFunction,
  SchemaTable,
} from "../types/schema.types.js";

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

const FALLBACK_WARNING = "No SQL table chunks were found in the vector store, so fallback demo schema data was used.";

export async function extractSchema(projectId: string): Promise<ExtractResult> {
  logger.info({ projectId }, "[DBSchemaAgent] Starting schema extraction");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  await repo.deleteSchemaForProject(projectId);
  logger.info({ projectId }, "[DBSchemaAgent] Cleared existing schema");

  const extractedAt = new Date().toISOString();
  const schemaVersion = await repo.createSchemaVersion(projectId, extractedAt);
  logger.info({ projectId, version: schemaVersion.version }, "[DBSchemaAgent] Schema version created");

  let rawTables: RawTable[] = [];
  let rawFunctions: RawFunction[] = [];
  let rawRelationships: RawRelationship[] = [];
  let rawViews: RawView[] = [];
  let rawQueryUsage: RawQueryTableUsage[] = [];
  let source: ExtractResult["source"] = "real";
  let warning: string | null = null;

  const { sqlTableDocs, sqlFnDocs, sqlViewDocs } = selectSqlSchemaChunks(projectId);

  logger.info(
    { projectId, sqlTableChunks: sqlTableDocs.length, sqlFnChunks: sqlFnDocs.length, sqlViewChunks: sqlViewDocs.length },
    "[DBSchemaAgent] SQL chunks found in vector store",
  );

  if (sqlTableDocs.length > 0) {
    for (const doc of sqlTableDocs) {
      const parsed = parseCreateTable(doc.content);
      if (parsed) rawTables.push(parsed);
      rawRelationships.push(...parseForeignKeyRelationships(doc.content));
    }
    for (const doc of sqlFnDocs) {
      const parsed = parseCreateFunction(doc.content);
      if (parsed) rawFunctions.push(parsed);
      const sourceName = parsed?.name ?? doc.metadata["name"] ?? "unknown";
      rawQueryUsage.push(...parseQueryTableUsage(doc.content, doc.metadata["type"] ?? "sql_function", sourceName));
    }
    for (const doc of sqlViewDocs) {
      const parsed = parseCreateView(doc.content);
      if (parsed) {
        rawViews.push(parsed);
        rawQueryUsage.push(...parseQueryTableUsage(doc.content, "sql_view", parsed.name));
      } else {
        rawQueryUsage.push(...parseQueryTableUsage(doc.content, "sql_view", doc.metadata["name"] ?? "unknown"));
      }
    }
    logger.info(
      {
        projectId,
        tables: rawTables.length,
        functions: rawFunctions.length,
        relationships: rawRelationships.length,
        views: rawViews.length,
        queryUsage: rawQueryUsage.length,
      },
      "[DBSchemaAgent] Parsed from real SQL chunks",
    );
  } else {
    source = "fallback";
    warning = FALLBACK_WARNING;
    logger.warn({ projectId, warning }, "[DBSchemaAgent] Fallback schema used");
    rawTables = FALLBACK_SCHEMA;
    rawFunctions = FALLBACK_FUNCTIONS;
  }

  if (rawViews.length === 0 && sqlViewDocs.length > 0) {
    for (const doc of sqlViewDocs) {
      const parsed = parseCreateView(doc.content);
      if (parsed) {
        rawViews.push(parsed);
        rawQueryUsage.push(...parseQueryTableUsage(doc.content, "sql_view", parsed.name));
      } else {
        rawQueryUsage.push(...parseQueryTableUsage(doc.content, "sql_view", doc.metadata["name"] ?? "unknown"));
      }
    }
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

  const viewKeys = new Set<string>();
  let viewCount = 0;
  for (const view of rawViews) {
    if (viewKeys.has(view.name)) continue;
    viewKeys.add(view.name);

    await repo.insertView({
      id: crypto.randomUUID(),
      project_id: projectId,
      name: view.name,
      definition: view.definition,
      created_at: extractedAt,
    });
    viewCount++;
  }

  const relationshipKeys = new Set<string>();
  let relationshipCount = 0;
  for (const rel of rawRelationships) {
    const key = `${rel.fromTable}.${rel.fromColumn}->${rel.toTable}.${rel.toColumn}`;
    if (relationshipKeys.has(key)) continue;
    relationshipKeys.add(key);

    await repo.insertRelationship({
      id: crypto.randomUUID(),
      project_id: projectId,
      from_table: rel.fromTable,
      from_column: rel.fromColumn,
      to_table: rel.toTable,
      to_column: rel.toColumn,
      constraint_name: rel.constraintName,
      created_at: extractedAt,
    });
    relationshipCount++;
  }

  const usageKeys = new Set<string>();
  let usageCount = 0;
  for (const usage of rawQueryUsage) {
    const key = `${usage.sourceType}:${usage.sourceName}:${usage.tableName}:${usage.operation}:${usage.isJoin ? 1 : 0}`;
    if (usageKeys.has(key)) continue;
    usageKeys.add(key);

    await repo.insertQueryTableUsage({
      id: crypto.randomUUID(),
      project_id: projectId,
      source_type: usage.sourceType,
      source_name: usage.sourceName,
      table_name: usage.tableName,
      operation: usage.operation,
      is_join: usage.isJoin ? 1 : 0,
      created_at: extractedAt,
    });
    usageCount++;
  }

  logger.info(
    { projectId, tables: tables.length, functions: functions.length, relationships: relationshipCount, views: viewCount, queryUsage: usageCount },
    "[DBSchemaAgent] Extraction complete",
  );

  chroma.createOrGetCollection(projectId);
  const schemaDocs = buildSchemaEmbeddingDocuments({
    projectId,
    tables,
    functions,
    relationships: rawRelationships,
    views: rawViews,
    queryUsage: rawQueryUsage,
  });

  chroma.upsertDocuments(projectId, schemaDocs);
  logger.info({ projectId, schemaChunks: schemaDocs.length }, "[DBSchemaAgent] Schema indexed in vector store");

  return { projectId, version: schemaVersion.version, tables, functions, extractedAt, source, warning };
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
  const schemaVersion = await repo.getLatestSchemaVersion(projectId);
  return { projectId, version: schemaVersion?.version ?? 1, tables, functions, extractedAt, source: "real", warning: null };
}
