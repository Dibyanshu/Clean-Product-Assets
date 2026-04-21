import Fastify, { type FastifyError } from "fastify";
import sensible from "@fastify/sensible";
import corsPlugin from "./plugins/cors.js";
import dbPlugin from "./plugins/db.js";
import routes from "./routes/index.js";

const isProduction = process.env.NODE_ENV === "production";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      ...(isProduction
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }),
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    },
  });

  await app.register(corsPlugin);
  await app.register(sensible);
  await app.register(dbPlugin);
  await app.register(routes, { prefix: "/api" });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    app.log.error({ err: error }, "Unhandled error");
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: error.message ?? "Internal Server Error",
      statusCode,
    });
  });

  return app;
}
