import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as prdService from "../service/prd.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const GeneratePRDBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function generatePRDHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = GeneratePRDBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("prd-generator", projectId);

  request.log.info({ jobId: job.id, projectId }, "[PRDAgent] Job started");
  updateJob(job.id, { status: "running", message: "Generating PRD via LLM" });

  try {
    const result = await prdService.generateProjectPRD(projectId);
    updateJob(job.id, {
      status: "completed",
      message: "PRD generation complete",
      completedAt: new Date().toISOString(),
      result,
    });

    reply.code(201).send({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "PRD generation failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    request.log.error({ err }, "[PRDAgent] Job failed");
    reply.code(500).send({ error: "PRD generation failed", message: String(err) });
  }
}

export async function listDocumentsHandler(
  request: FastifyRequest<{ Params: { projectId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { projectId } = request.params;
  const documents = await prdService.getDocumentsByProject(projectId);
  reply.send({ documents });
}
