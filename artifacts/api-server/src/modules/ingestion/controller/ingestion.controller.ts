import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as ingestionService from "../service/ingestion.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const IngestBodySchema = z.object({
  repoUrl: z.string().url("repoUrl must be a valid URL"),
});

export async function ingestHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = IngestBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { repoUrl } = parsed.data;
  const job = createJob("ingestion");

  request.log.info({ jobId: job.id, repoUrl }, "[IngestionAgent] Job started");
  updateJob(job.id, { status: "running", message: "Cloning and reading repository" });

  try {
    const result = await ingestionService.ingestRepository(repoUrl);
    updateJob(job.id, {
      status: "completed",
      message: "Ingestion complete",
      completedAt: new Date().toISOString(),
      result,
    });

    reply.code(201).send({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Ingestion failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    request.log.error({ err }, "[IngestionAgent] Job failed");
    reply.code(500).send({ error: "Ingestion failed", message: String(err) });
  }
}

export async function listProjectsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const projects = await ingestionService.listAllProjects();
  reply.send({ projects });
}

export async function getProjectHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const project = await ingestionService.getProject(id);
  if (!project) {
    reply.code(404).send({ error: "Project not found" });
    return;
  }
  reply.send(project);
}
