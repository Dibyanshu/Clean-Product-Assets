import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireLocal = createRequire(import.meta.url);

type SqlJsStatic = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlDatabase;
};

type SqlDatabase = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlStatement;
  close(): void;
};

type SqlStatement = {
  run(params?: unknown[]): void;
  get(params?: unknown[]): unknown[] | undefined;
  all(params?: unknown[]): unknown[][];
  free(): void;
};

let _db: SqlDatabase | null = null;

export async function getDb(): Promise<SqlDatabase> {
  if (_db) return _db;

  const sqlJsPath = requireLocal.resolve("sql.js/dist/sql-asm.js");
  const initSqlJs = requireLocal(sqlJsPath) as (
    config?: Record<string, unknown>,
  ) => Promise<SqlJsStatic>;

  const SQL = await initSqlJs();
  _db = new SQL.Database();

  logger.info("SQLite (sql.js) database initialized");
  return _db;
}

export function rowsToObjects(
  result: { columns: string[]; values: unknown[][] }[],
): Record<string, unknown>[] {
  if (!result.length) return [];
  const { columns, values } = result[0]!;
  return values.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]])),
  );
}
