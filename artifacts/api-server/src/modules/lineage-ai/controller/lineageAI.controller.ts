import type { FastifyInstance } from "fastify";
import * as lineageAIService from "../service/lineageAI.service.js";

export async function lineageAIController(fastify: FastifyInstance) {
  // POST /agent/lineage-ai — enhance single API
  fastify.post("/lineage-ai", async (request, reply) => {
    const { projectId, apiId } = request.body as { projectId?: string; apiId?: string };
    if (!projectId || !apiId) {
      return reply.status(400).send({ error: "projectId and apiId are required" });
    }
    try {
      const result = await lineageAIService.enhanceSingle(projectId, apiId);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[LineageAI] enhanceSingle failed");
      return reply.status(500).send({ error: String(err) });
    }
  });

  // POST /agent/lineage-ai/bulk — enhance all APIs for a project
  fastify.post("/lineage-ai/bulk", async (request, reply) => {
    const { projectId } = request.body as { projectId?: string };
    if (!projectId) {
      return reply.status(400).send({ error: "projectId is required" });
    }
    try {
      const result = await lineageAIService.enhanceBulk(projectId);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[LineageAI] enhanceBulk failed");
      return reply.status(500).send({ error: String(err) });
    }
  });

  // POST /agent/lineage-ai/refresh — clear cache for a project
  fastify.post("/lineage-ai/refresh", async (request, reply) => {
    const { projectId } = request.body as { projectId?: string };
    if (!projectId) {
      return reply.status(400).send({ error: "projectId is required" });
    }
    try {
      const result = await lineageAIService.refreshCache(projectId);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[LineageAI] refreshCache failed");
      return reply.status(500).send({ error: String(err) });
    }
  });
}
