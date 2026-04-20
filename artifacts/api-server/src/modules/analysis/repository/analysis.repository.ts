import { getDb, rowsToObjects } from "../../../db/sqlite.js";
import { generateId } from "../../../utils/id.js";

export interface ApiRoute {
  id: string;
  project_id: string;
  method: string;
  path: string;
  description: string | null;
  handler: string | null;
  created_at: string;
}

export async function insertApiRoute(
  projectId: string,
  method: string,
  path: string,
  description: string | null,
  handler: string | null,
): Promise<ApiRoute> {
  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO apis (id, project_id, method, path, description, handler, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, projectId, method, path, description, handler, now],
  );

  return { id, project_id: projectId, method, path, description, handler, created_at: now };
}

export async function listApisByProject(projectId: string): Promise<ApiRoute[]> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM apis WHERE project_id = ? ORDER BY created_at ASC`, [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as ApiRoute[];
}

export async function deleteApisByProject(projectId: string): Promise<void> {
  const db = await getDb();
  db.run(`DELETE FROM apis WHERE project_id = ?`, [projectId] as unknown[]);
}
