import { getDb, rowsToObjects } from "../../../db/sqlite.js";

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

export async function deleteSchemaForProject(projectId: string): Promise<void> {
  const db = await getDb();
  const tables = await getTablesForProject(projectId);
  for (const t of tables) {
    db.run(`DELETE FROM db_columns WHERE table_id = ?`, [t.id]);
  }
  db.run(`DELETE FROM db_tables WHERE project_id = ?`, [projectId]);
  db.run(`DELETE FROM db_functions WHERE project_id = ?`, [projectId]);
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
