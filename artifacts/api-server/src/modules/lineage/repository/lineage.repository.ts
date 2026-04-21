import { getDb, rowsToObjects } from "../../../db/sqlite.js";
import { generateId } from "../../../utils/id.js";

export type SqlOperation = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "QUERY";
export type LineageSource = "deterministic" | "llm" | "merged";
export type ConfidenceLevel = "high" | "medium" | "low" | "conflict";

export interface ApiFunctionMap {
  id: string;
  project_id: string;
  api_id: string;
  function_name: string;
  confidence: number;
}

export interface FunctionTableMap {
  id: string;
  project_id: string;
  function_name: string;
  table_name: string;
  operation: SqlOperation;
  confidence: number;
}

export interface ApiTableMap {
  id: string;
  project_id: string;
  api_id: string;
  table_name: string;
  operation: SqlOperation;
  confidence: number;
  source: LineageSource;
  confidence_level: ConfidenceLevel;
  prompt_version: string | null;
}

export interface InsertApiTableMapOptions {
  source?: LineageSource;
  confidence_level?: ConfidenceLevel;
  prompt_version?: string | null;
}

export function confidenceLevelFromFloat(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
}

export async function clearLineageForProject(projectId: string): Promise<void> {
  const db = await getDb();
  db.run("DELETE FROM api_function_map WHERE project_id = ?", [projectId] as unknown[]);
  db.run("DELETE FROM function_table_map WHERE project_id = ?", [projectId] as unknown[]);
  db.run("DELETE FROM api_table_map WHERE project_id = ?", [projectId] as unknown[]);
}

export async function clearApiTableMapForApi(projectId: string, apiId: string): Promise<void> {
  const db = await getDb();
  db.run("DELETE FROM api_table_map WHERE project_id = ? AND api_id = ?", [projectId, apiId] as unknown[]);
}

export async function insertApiFunctionMap(
  projectId: string,
  apiId: string,
  functionName: string,
  confidence: number,
): Promise<ApiFunctionMap> {
  const db = await getDb();
  const id = generateId();
  db.run(
    "INSERT INTO api_function_map (id, project_id, api_id, function_name, confidence) VALUES (?, ?, ?, ?, ?)",
    [id, projectId, apiId, functionName, confidence] as unknown[],
  );
  return { id, project_id: projectId, api_id: apiId, function_name: functionName, confidence };
}

export async function insertFunctionTableMap(
  projectId: string,
  functionName: string,
  tableName: string,
  operation: SqlOperation,
  confidence: number,
): Promise<FunctionTableMap> {
  const db = await getDb();
  const id = generateId();
  db.run(
    "INSERT INTO function_table_map (id, project_id, function_name, table_name, operation, confidence) VALUES (?, ?, ?, ?, ?, ?)",
    [id, projectId, functionName, tableName, operation, confidence] as unknown[],
  );
  return { id, project_id: projectId, function_name: functionName, table_name: tableName, operation, confidence };
}

export async function insertApiTableMap(
  projectId: string,
  apiId: string,
  tableName: string,
  operation: SqlOperation,
  confidence: number,
  opts: InsertApiTableMapOptions = {},
): Promise<ApiTableMap> {
  const db = await getDb();
  const id = generateId();
  const source: LineageSource = opts.source ?? "deterministic";
  const confidence_level: ConfidenceLevel = opts.confidence_level ?? confidenceLevelFromFloat(confidence);
  const prompt_version = opts.prompt_version ?? null;
  db.run(
    `INSERT INTO api_table_map
       (id, project_id, api_id, table_name, operation, confidence, source, confidence_level, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, apiId, tableName, operation, confidence, source, confidence_level, prompt_version] as unknown[],
  );
  return {
    id,
    project_id: projectId,
    api_id: apiId,
    table_name: tableName,
    operation,
    confidence,
    source,
    confidence_level,
    prompt_version,
  };
}

export async function getApiFunctionMaps(projectId: string): Promise<ApiFunctionMap[]> {
  const db = await getDb();
  const result = db.exec("SELECT * FROM api_function_map WHERE project_id = ? ORDER BY api_id", [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as ApiFunctionMap[];
}

export async function getFunctionTableMaps(projectId: string): Promise<FunctionTableMap[]> {
  const db = await getDb();
  const result = db.exec("SELECT * FROM function_table_map WHERE project_id = ? ORDER BY function_name", [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as FunctionTableMap[];
}

export async function getApiTableMaps(projectId: string): Promise<ApiTableMap[]> {
  const db = await getDb();
  const result = db.exec("SELECT * FROM api_table_map WHERE project_id = ? ORDER BY api_id", [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as ApiTableMap[];
}

export async function getApiTableMapsForApi(projectId: string, apiId: string): Promise<ApiTableMap[]> {
  const db = await getDb();
  const result = db.exec(
    "SELECT * FROM api_table_map WHERE project_id = ? AND api_id = ? ORDER BY table_name",
    [projectId, apiId] as unknown[],
  );
  return rowsToObjects(result) as unknown as ApiTableMap[];
}
