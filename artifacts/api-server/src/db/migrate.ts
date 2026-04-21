import { getDb } from "./sqlite.js";
import { logger } from "../lib/logger.js";

export async function runMigrations(): Promise<void> {
  const db = await getDb();

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      repo_url TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      file_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      extension TEXT,
      size_bytes INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS apis (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      handler TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES documents(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS db_tables (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      extracted_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS db_columns (
      id TEXT PRIMARY KEY,
      table_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      is_nullable INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (table_id) REFERENCES db_tables(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS db_functions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parameters TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_function_map (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      api_id TEXT NOT NULL,
      function_name TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (api_id) REFERENCES apis(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS function_table_map (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      function_name TEXT NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_table_map (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      api_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (api_id) REFERENCES apis(id)
    )
  `);

  logger.info("Database migrations complete");
}
