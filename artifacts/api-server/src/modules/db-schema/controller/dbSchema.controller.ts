import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as dbSchemaService from "../service/dbSchema.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const ExtractBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function extractDbSchemaHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = ExtractBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("db-schema", projectId);

  request.log.info({ jobId: job.id, projectId }, "[DBSchemaAgent] Job started");
  updateJob(job.id, { status: "running", message: "Extracting database schema" });

  try {
    const result = await dbSchemaService.extractSchema(projectId);
    updateJob(job.id, {
      status: "completed",
      message: "Schema extraction complete",
      completedAt: new Date().toISOString(),
      projectId,
      result,
    });

    reply.code(201).send({
      jobId: job.id,
      projectId,
      tableCount: result.tables.length,
      functionCount: result.functions.length,
      tables: result.tables,
      functions: result.functions,
      extractedAt: result.extractedAt,
    });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Schema extraction failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    request.log.error({ err }, "[DBSchemaAgent] Job failed");
    reply.code(500).send({ error: "Schema extraction failed", message: String(err) });
  }
}

export async function getDbSchemaHandler(
  request: FastifyRequest<{ Params: { projectId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { projectId } = request.params;
  const schema = await dbSchemaService.getSchema(projectId);

  if (!schema) {
    reply.send({ tables: [], functions: [], extractedAt: null });
    return;
  }

  reply.send(schema);
}
