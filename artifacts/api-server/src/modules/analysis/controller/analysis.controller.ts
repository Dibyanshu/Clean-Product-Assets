import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as analysisService from "../service/analysis.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const AnalyzeBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function analyzeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parsed = AnalyzeBodySchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("analysis", projectId);

  request.log.info({ jobId: job.id, projectId }, "[AnalysisAgent] Job started");
  updateJob(job.id, { status: "running", message: "Extracting API routes from files" });

  try {
    const result = await analysisService.analyzeProject(projectId);
    updateJob(job.id, {
      status: "completed",
      message: "Analysis complete",
      completedAt: new Date().toISOString(),
      result,
    });

    reply.code(201).send({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Analysis failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    request.log.error({ err }, "[AnalysisAgent] Job failed");
    reply.code(500).send({ error: "Analysis failed", message: String(err) });
  }
}

export async function listApisHandler(
  request: FastifyRequest<{ Params: { projectId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { projectId } = request.params;
  const apis = await analysisService.getApisByProject(projectId);
  reply.send({ apis });
}
