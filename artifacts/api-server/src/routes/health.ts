import type { FastifyPluginAsync } from "fastify";
import { HealthCheckResponse } from "@workspace/api-zod";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/healthz", async (_request, _reply) => {
    return HealthCheckResponse.parse({ status: "ok" });
  });
};

export default healthRoutes;
