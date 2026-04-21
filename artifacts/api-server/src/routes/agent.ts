import type { FastifyPluginAsync } from "fastify";
import {
  ingestHandler,
  listProjectsHandler,
  getProjectHandler,
} from "../modules/ingestion/controller/ingestion.controller.js";
import {
  analyzeHandler,
  listApisHandler,
} from "../modules/analysis/controller/analysis.controller.js";
import {
  generatePRDHandler,
  listDocumentsHandler,
} from "../modules/prd/controller/prd.controller.js";
import {
  extractDbSchemaHandler,
  getDbSchemaHandler,
} from "../modules/db-schema/controller/dbSchema.controller.js";
import { searchHandler } from "../modules/search/controller/search.controller.js";
import { testAstMultiHandler } from "../modules/ast-test/controller/astTest.controller.js";
import { generateLineageHandler, getLineageHandler } from "../modules/lineage/controller/lineage.controller.js";
import { listJobs, getJob } from "../utils/jobTracker.js";

const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/agent/ingest", ingestHandler);
  fastify.get("/agent/projects", listProjectsHandler);
  fastify.get("/agent/projects/:id", getProjectHandler);

  fastify.post("/agent/analyze", analyzeHandler);
  fastify.get("/agent/projects/:projectId/apis", listApisHandler);

  fastify.post("/agent/generate-prd", generatePRDHandler);
  fastify.get("/agent/projects/:projectId/documents", listDocumentsHandler);

  fastify.post("/agent/extract-db-schema", extractDbSchemaHandler);
  fastify.get("/agent/projects/:projectId/db-schema", getDbSchemaHandler);

  fastify.get("/agent/search", searchHandler);
  fastify.post("/agent/test-ast-multi", testAstMultiHandler);

  fastify.post("/agent/generate-lineage", generateLineageHandler);
  fastify.get("/agent/lineage", getLineageHandler);

  fastify.get("/agent/jobs", async (_request, reply) => {
    return reply.send({ jobs: listJobs() });
  });

  fastify.get<{ Params: { id: string } }>("/agent/jobs/:id", async (request, reply) => {
    const job = getJob(request.params.id);
    if (!job) {
      return reply.code(404).send({ error: "Job not found" });
    }
    return reply.send(job);
  });
};

export default agentRoutes;
