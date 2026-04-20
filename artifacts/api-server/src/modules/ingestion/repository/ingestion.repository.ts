import { getDb, rowsToObjects } from "../../../db/sqlite.js";
import { generateId } from "../../../utils/id.js";

export interface Project {
  id: string;
  repo_url: string;
  name: string;
  status: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  path: string;
  extension: string | null;
  size_bytes: number;
  created_at: string;
}

export async function createProject(
  repoUrl: string,
  name: string,
): Promise<Project> {
  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO projects (id, repo_url, name, status, file_count, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
    [id, repoUrl, name, now, now],
  );

  return { id, repo_url: repoUrl, name, status: "pending", file_count: 0, created_at: now, updated_at: now };
}

export async function updateProjectStatus(
  id: string,
  status: string,
  fileCount?: number,
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  if (fileCount !== undefined) {
    db.run(
      `UPDATE projects SET status = ?, file_count = ?, updated_at = ? WHERE id = ?`,
      [status, fileCount, now, id],
    );
  } else {
    db.run(
      `UPDATE projects SET status = ?, updated_at = ? WHERE id = ?`,
      [status, now, id],
    );
  }
}

export async function findProjectById(id: string): Promise<Project | null> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM projects WHERE id = ?`, [id] as unknown[]);
  const rows = rowsToObjects(result);
  return rows.length > 0 ? (rows[0] as unknown as Project) : null;
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM projects ORDER BY created_at DESC`);
  return rowsToObjects(result) as unknown as Project[];
}

export async function insertFile(
  projectId: string,
  filePath: string,
  extension: string | null,
  sizeBytes: number,
): Promise<ProjectFile> {
  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO files (id, project_id, path, extension, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, projectId, filePath, extension, sizeBytes, now],
  );

  return { id, project_id: projectId, path: filePath, extension, size_bytes: sizeBytes, created_at: now };
}

export async function listFilesByProject(projectId: string): Promise<ProjectFile[]> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM files WHERE project_id = ?`, [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as ProjectFile[];
}
