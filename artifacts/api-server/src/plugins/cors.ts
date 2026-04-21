import fp from "fastify-plugin";
import cors from "@fastify/cors";
import type { FastifyPluginAsync } from "fastify";

const corsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(cors, { origin: true });
};

export default fp(corsPlugin, { name: "cors" });
