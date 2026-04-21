import type { FastifyPluginAsync } from "fastify";
import healthRoutes from "./health.js";
import agentRoutes from "./agent.js";

const routes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(healthRoutes);
  await fastify.register(agentRoutes);
};

export default routes;
