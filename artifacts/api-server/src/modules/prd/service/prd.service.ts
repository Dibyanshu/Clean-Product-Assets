import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as analysisRepo from "../../analysis/repository/analysis.repository.js";
import * as prdRepo from "../repository/prd.repository.js";
import { generate, parsePrdOutput } from "../../../services/llm.service.js";
import { buildPrdPrompt } from "../../../services/prompt.service.js";
import { queryDocuments } from "../../../services/chroma.service.js";
import { generatePRD } from "../services/llm.service.js";

export interface PRDResult {
  documentId: string;
  projectId: string;
  title: string;
  prd: {
    title: string;
    overview: string;
    sections: Array<{ title: string; content: string }>;
    generatedAt: string;
  };
}

export async function generateProjectPRD(projectId: string): Promise<PRDResult> {
  logger.info({ projectId }, "[PRDAgent] Starting PRD generation");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) throw new Error("No APIs found. Run analysis first.");

  let prd: PRDResult["prd"];

  try {
    const contextResults = await queryDocuments(projectId, "business logic authentication authorization user role", 8);
    const dedupedChunks = Array.from(
      new Map(contextResults.map((r) => [r.content.slice(0, 80), r])).values()
    ).slice(0, 6);

    const { text: prompt, version } = buildPrdPrompt({
      projectName: project.name,
      apis,
      contextChunks: dedupedChunks.map((r) => ({
        content: r.content,
        file: r.metadata["file"],
        type: r.metadata["type"],
      })),
    });

    logger.info({ projectId, apiCount: apis.length, contextChunks: dedupedChunks.length, promptVersion: version }, "[PRDAgent] Sending to LLM");

    const raw = await generate(prompt, {
      promptName: "prd_generation",
      promptVersion: version,
      projectId,
      maxTokens: 1500,
    });

    const parsed = parsePrdOutput(raw);
    prd = { ...parsed, generatedAt: new Date().toISOString() };

    logger.info({ projectId, sections: prd.sections.length }, "[PRDAgent] LLM PRD generated successfully");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ projectId, error: message }, "[PRDAgent] LLM failed — falling back to deterministic template");

    const fallback = generatePRD(project.name, apis);
    prd = fallback;
  }

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
