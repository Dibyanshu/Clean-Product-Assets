import { getDb, rowsToObjects } from "../../../db/sqlite.js";
import { generateId } from "../../../utils/id.js";

export interface Document {
  id: string;
  project_id: string;
  type: string;
  title: string;
  content: string;
  created_at: string;
}

export interface Approval {
  id: string;
  document_id: string;
  status: string;
  reviewer: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function insertDocument(
  projectId: string,
  type: string,
  title: string,
  content: string,
): Promise<Document> {
  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO documents (id, project_id, type, title, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, projectId, type, title, content, now],
  );

  return { id, project_id: projectId, type, title, content, created_at: now };
}

export async function listDocumentsByProject(projectId: string): Promise<Document[]> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM documents WHERE project_id = ? ORDER BY created_at DESC`, [projectId] as unknown[]);
  return rowsToObjects(result) as unknown as Document[];
}

export async function findDocumentById(id: string): Promise<Document | null> {
  const db = await getDb();
  const result = db.exec(`SELECT * FROM documents WHERE id = ?`, [id] as unknown[]);
  const rows = rowsToObjects(result);
  return rows.length > 0 ? (rows[0] as unknown as Document) : null;
}

export async function findLatestDocumentByProjectAndType(projectId: string, type: string): Promise<Document | null> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM documents WHERE project_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`,
    [projectId, type] as unknown[],
  );
  const rows = rowsToObjects(result);
  return rows.length > 0 ? (rows[0] as unknown as Document) : null;
}

export async function deleteDocumentsByProjectAndType(projectId: string, type: string): Promise<number> {
  const db = await getDb();
  db.run(`DELETE FROM documents WHERE project_id = ? AND type = ?`, [projectId, type] as unknown[]);
  return 0;
}

export async function createApproval(documentId: string): Promise<Approval> {
  const db = await getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO approvals (id, document_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)`,
    [id, documentId, now, now],
  );

  return { id, document_id: documentId, status: "pending", reviewer: null, notes: null, created_at: now, updated_at: now };
}
