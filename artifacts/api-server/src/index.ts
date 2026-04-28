import { buildApp } from "./app.js";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const app = await buildApp();

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error({ err }, "Error starting server");
  process.exit(1);
}
