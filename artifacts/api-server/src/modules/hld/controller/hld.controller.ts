import type { FastifyInstance } from "fastify";
import * as hldService from "../service/hld.service.js";

export async function hldController(fastify: FastifyInstance) {
  // POST /agent/generate-hld — generate HLD from lineage + Chroma context
  fastify.post("/generate-hld", async (request, reply) => {
    const { projectId } = request.body as { projectId?: string };
    if (!projectId) {
      return reply.status(400).send({ error: "projectId is required" });
    }
    try {
      const result = await hldService.generateHld(projectId);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[HLD] generateHld failed");
      return reply.status(500).send({ error: String(err) });
    }
  });

  // GET /agent/hld?projectId=xxx — get the latest stored HLD
  fastify.get("/hld", async (request, reply) => {
    const { projectId } = request.query as { projectId?: string };
    if (!projectId) {
      return reply.status(400).send({ error: "projectId is required" });
    }
    try {
      const result = await hldService.getHld(projectId);
      if (!result) {
        return reply.status(404).send({ error: "No HLD found for this project. Run generate-hld first." });
      }
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[HLD] getHld failed");
      return reply.status(500).send({ error: String(err) });
    }
  });

  // POST /agent/hld/refresh — delete existing HLD and regenerate
  fastify.post("/hld/refresh", async (request, reply) => {
    const { projectId } = request.body as { projectId?: string };
    if (!projectId) {
      return reply.status(400).send({ error: "projectId is required" });
    }
    try {
      const result = await hldService.refreshHld(projectId);
      return reply.status(200).send(result);
    } catch (err) {
      fastify.log.error(err, "[HLD] refreshHld failed");
      return reply.status(500).send({ error: String(err) });
    }
  });
}
