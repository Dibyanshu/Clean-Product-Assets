import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../repository/ingestion.repository.js";

const MOCK_FILE_TREE = [
  { path: "src/index.js", extension: ".js", size: 1240 },
  { path: "src/routes/users.js", extension: ".js", size: 3200 },
  { path: "src/routes/products.js", extension: ".js", size: 2800 },
  { path: "src/middleware/auth.js", extension: ".js", size: 950 },
  { path: "src/models/User.js", extension: ".js", size: 1800 },
  { path: "src/models/Product.js", extension: ".js", size: 2100 },
  { path: "src/services/emailService.js", extension: ".js", size: 1500 },
  { path: "src/config/database.js", extension: ".js", size: 680 },
  { path: "package.json", extension: ".json", size: 720 },
  { path: "README.md", extension: ".md", size: 3400 },
];

export interface IngestResult {
  projectId: string;
  projectName: string;
  fileCount: number;
  files: ingestionRepo.ProjectFile[];
}

export async function ingestRepository(repoUrl: string): Promise<IngestResult> {
  const repoName = repoUrl.split("/").pop()?.replace(".git", "") ?? "unknown-project";
  logger.info({ repoUrl, repoName }, "[IngestionAgent] Starting ingestion");

  const project = await ingestionRepo.createProject(repoUrl, repoName);
  logger.info({ projectId: project.id }, "[IngestionAgent] Project created");

  await ingestionRepo.updateProjectStatus(project.id, "ingesting");

  const files: ingestionRepo.ProjectFile[] = [];
  for (const f of MOCK_FILE_TREE) {
    const file = await ingestionRepo.insertFile(project.id, f.path, f.extension, f.size);
    files.push(file);
  }

  await ingestionRepo.updateProjectStatus(project.id, "ingested", files.length);
  logger.info({ projectId: project.id, fileCount: files.length }, "[IngestionAgent] Ingestion complete");

  return { projectId: project.id, projectName: repoName, fileCount: files.length, files };
}

export async function getProject(projectId: string) {
  return ingestionRepo.findProjectById(projectId);
}

export async function listAllProjects() {
  return ingestionRepo.listProjects();
}
