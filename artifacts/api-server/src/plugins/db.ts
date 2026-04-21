import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { runMigrations } from "../db/migrate.js";

const dbPlugin: FastifyPluginAsync = async (fastify) => {
  await runMigrations();
  fastify.log.info("Database plugin registered — migrations complete");
};

export default fp(dbPlugin, { name: "db" });
