import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as analysisRepo from "../../analysis/repository/analysis.repository.js";
import * as prdRepo from "../repository/prd.repository.js";
import { generatePRD } from "../services/llm.service.js";

export interface PRDResult {
  documentId: string;
  projectId: string;
  title: string;
  prd: ReturnType<typeof generatePRD>;
}

export async function generateProjectPRD(projectId: string): Promise<PRDResult> {
  logger.info({ projectId }, "[PRDAgent] Starting PRD generation");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) throw new Error("No APIs found. Run analysis first.");

  logger.info({ projectId, apiCount: apis.length }, "[PRDAgent] Generating PRD via mock LLM");
  const prd = generatePRD(project.name, apis);

  const doc = await prdRepo.insertDocument(
    projectId,
    "PRD",
    prd.title,
    JSON.stringify(prd, null, 2),
  );

  await prdRepo.createApproval(doc.id);
  logger.info({ projectId, documentId: doc.id }, "[PRDAgent] PRD stored with pending approval");

  return { documentId: doc.id, projectId, title: prd.title, prd };
}

export async function getDocumentsByProject(projectId: string) {
  return prdRepo.listDocumentsByProject(projectId);
}
