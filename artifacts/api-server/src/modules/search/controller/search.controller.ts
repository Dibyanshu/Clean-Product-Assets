import type { FastifyRequest, FastifyReply } from "fastify";
import * as chroma from "../../../services/chroma.service.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import { logger } from "../../../lib/logger.js";

interface SearchQuery {
  projectId: string;
  q: string;
  n?: string;
}

export async function searchHandler(
  request: FastifyRequest<{ Querystring: SearchQuery }>,
  reply: FastifyReply,
) {
  const { projectId, q, n } = request.query;

  if (!projectId?.trim() || !q?.trim()) {
    return reply.code(400).send({ error: "projectId and q query params are required" });
  }

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) {
    return reply.code(404).send({ error: `Project not found: ${projectId}` });
  }

  const nResults = Math.min(Math.max(parseInt(n ?? "5", 10) || 5, 1), 20);
  const indexedCount = chroma.getDocumentCount(projectId);

  logger.info({ projectId, q, nResults, indexedCount }, "[SearchAgent] Semantic search");

  const results = chroma.queryDocuments(projectId, q, nResults);

  return reply.send({
    projectId,
    query: q,
    indexedDocuments: indexedCount,
    results,
  });
}
