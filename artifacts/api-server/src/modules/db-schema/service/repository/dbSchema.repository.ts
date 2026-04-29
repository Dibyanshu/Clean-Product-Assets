import { getDb, rowsToObjects } from "../../../../db/sqlite.js";

export interface DbTableRecord {
  id: string;
  project_id: string;
  name: string;
  extracted_at: string;
}

export interface DbColumnRecord {
  id: string;
  table_id: string;
  name: string;
  type: string;
  is_primary: number;
  is_nullable: number;
}

export interface DbFunctionRecord {
  id: string;
  project_id: string;
  name: string;
  parameters: string | null;
  description: string | null;
  created_at: string;
}

export interface SchemaVersionRecord {
  id: string;
  project_id: string;
  version: number;
  extracted_at: string;
}

export interface DbRelationshipRecord {
  id: string;
  project_id: string;
  from_table: string;
  from_column: string;
  to_table: string;
  to_column: string;
  constraint_name: string | null;
  created_at: string;
}

export interface DbViewRecord {
  id: string;
  project_id: string;
  name: string;
  definition: string;
  created_at: string;
}

export interface QueryTableUsageRecord {
  id: string;
  project_id: string;
  source_type: string;
  source_name: string;
  table_name: string;
  operation: string;
  is_join: number;
  created_at: string;
}

export async function deleteSchemaForProject(projectId: string): Promise<void> {
  const db = await getDb();
  const tables = await getTablesForProject(projectId);
  for (const t of tables) {
    db.run(`DELETE FROM db_columns WHERE table_id = ?`, [t.id]);
  }
  db.run(`DELETE FROM db_tables WHERE project_id = ?`, [projectId]);
  db.run(`DELETE FROM db_functions WHERE project_id = ?`, [projectId]);
  db.run(`DELETE FROM db_relationships WHERE project_id = ?`, [projectId]);
  db.run(`DELETE FROM db_views WHERE project_id = ?`, [projectId]);
  db.run(`DELETE FROM query_table_usage WHERE project_id = ?`, [projectId]);
}

export async function insertTable(record: DbTableRecord): Promise<DbTableRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO db_tables (id, project_id, name, extracted_at) VALUES (?, ?, ?, ?)`,
    [record.id, record.project_id, record.name, record.extracted_at],
  );
  return record;
}

export async function insertColumn(record: DbColumnRecord): Promise<DbColumnRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO db_columns (id, table_id, name, type, is_primary, is_nullable) VALUES (?, ?, ?, ?, ?, ?)`,
    [record.id, record.table_id, record.name, record.type, record.is_primary, record.is_nullable],
  );
  return record;
}

export async function insertFunction(record: DbFunctionRecord): Promise<DbFunctionRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO db_functions (id, project_id, name, parameters, description, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [record.id, record.project_id, record.name, record.parameters, record.description, record.created_at],
  );
  return record;
}

export async function createSchemaVersion(projectId: string, extractedAt: string): Promise<SchemaVersionRecord> {
  const db = await getDb();
  const result = db.exec(
    `SELECT MAX(version) AS version FROM schema_versions WHERE project_id = ?`,
    [projectId],
  );
  const rows = rowsToObjects(result);
  const currentVersion = Number(rows[0]?.["version"] ?? 0);
  const record: SchemaVersionRecord = {
    id: crypto.randomUUID(),
    project_id: projectId,
    version: currentVersion + 1,
    extracted_at: extractedAt,
  };

  db.run(
    `INSERT INTO schema_versions (id, project_id, version, extracted_at) VALUES (?, ?, ?, ?)`,
    [record.id, record.project_id, record.version, record.extracted_at],
  );

  return record;
}

export async function getLatestSchemaVersion(projectId: string): Promise<SchemaVersionRecord | null> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM schema_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1`,
    [projectId],
  );
  const rows = rowsToObjects(result);
  const row = rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    project_id: String(row.project_id),
    version: Number(row.version),
    extracted_at: String(row.extracted_at),
  };
}

export async function insertRelationship(record: DbRelationshipRecord): Promise<DbRelationshipRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO db_relationships (id, project_id, from_table, from_column, to_table, to_column, constraint_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.project_id,
      record.from_table,
      record.from_column,
      record.to_table,
      record.to_column,
      record.constraint_name,
      record.created_at,
    ],
  );
  return record;
}

export async function insertView(record: DbViewRecord): Promise<DbViewRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO db_views (id, project_id, name, definition, created_at) VALUES (?, ?, ?, ?, ?)`,
    [record.id, record.project_id, record.name, record.definition, record.created_at],
  );
  return record;
}

export async function insertQueryTableUsage(record: QueryTableUsageRecord): Promise<QueryTableUsageRecord> {
  const db = await getDb();
  db.run(
    `INSERT INTO query_table_usage (id, project_id, source_type, source_name, table_name, operation, is_join, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.project_id,
      record.source_type,
      record.source_name,
      record.table_name,
      record.operation,
      record.is_join,
      record.created_at,
    ],
  );
  return record;
}

export async function getTablesForProject(projectId: string): Promise<DbTableRecord[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM db_tables WHERE project_id = ? ORDER BY name ASC`,
    [projectId],
  );
  return rowsToObjects(result).map((row) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    extracted_at: String(row.extracted_at),
  }));
}

export async function getColumnsForTable(tableId: string): Promise<DbColumnRecord[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM db_columns WHERE table_id = ? ORDER BY is_primary DESC, name ASC`,
    [tableId],
  );
  return rowsToObjects(result).map((row) => ({
    id: String(row.id),
    table_id: String(row.table_id),
    name: String(row.name),
    type: String(row.type),
    is_primary: Number(row.is_primary),
    is_nullable: Number(row.is_nullable),
  }));
}

export async function getFunctionsForProject(projectId: string): Promise<DbFunctionRecord[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM db_functions WHERE project_id = ? ORDER BY name ASC`,
    [projectId],
  );
  return rowsToObjects(result).map((row) => ({
    id: String(row.id),
    project_id: String(row.project_id),
    name: String(row.name),
    parameters: row.parameters !== undefined && row.parameters !== null ? String(row.parameters) : null,
    description: row.description !== undefined && row.description !== null ? String(row.description) : null,
    created_at: String(row.created_at),
  }));
}

export async function getLatestExtractedAt(projectId: string): Promise<string | null> {
  const db = await getDb();
  const result = db.exec(
    `SELECT MAX(extracted_at) AS extracted_at FROM db_tables WHERE project_id = ?`,
    [projectId],
  );
  const rows = rowsToObjects(result);
  return (rows[0]?.["extracted_at"] as string | null) ?? null;
}
