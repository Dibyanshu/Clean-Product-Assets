import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as lineageService from "../service/lineage.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const GenerateLineageBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function generateLineageHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = GenerateLineageBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("lineage", projectId);
  request.log.info({ jobId: job.id, projectId }, "[LineageAgent] Job started");
  updateJob(job.id, { status: "running", message: "Building API ↔ DB lineage map" });

  try {
    const result = await lineageService.generateLineage(projectId);
    updateJob(job.id, {
      status: "completed",
      message: `Lineage complete — ${result.mappedCount} mapped, ${result.partialCount} partial, ${result.unknownCount} unknown`,
      completedAt: new Date().toISOString(),
      projectId,
      result,
    });

    reply.code(201).send({
      jobId: job.id,
      projectId: result.projectId,
      apiCount: result.apiCount,
      mappedCount: result.mappedCount,
      partialCount: result.partialCount,
      unknownCount: result.unknownCount,
      entries: result.entries,
    });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Lineage generation failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    request.log.error({ err }, "[LineageAgent] Job failed");
    reply.code(500).send({ error: "Lineage generation failed", message: String(err) });
  }
}

export async function getLineageHandler(
  request: FastifyRequest<{ Querystring: { projectId?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { projectId } = request.query;
  if (!projectId) {
    reply.code(400).send({ error: "projectId query parameter is required" });
    return;
  }

  const result = await lineageService.getLineage(projectId);
  if (!result) {
    reply.send({
      projectId,
      apiCount: 0,
      mappedCount: 0,
      partialCount: 0,
      unknownCount: 0,
      entries: [],
    });
    return;
  }

  reply.send(result);
}
