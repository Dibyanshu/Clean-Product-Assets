import { type Request, type Response } from "express";
import { z } from "zod";
import * as analysisService from "../service/analysis.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const AnalyzeBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function analyzeHandler(req: Request, res: Response): Promise<void> {
  const parsed = AnalyzeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("analysis", projectId);

  req.log.info({ jobId: job.id, projectId }, "Analysis job started");
  updateJob(job.id, { status: "running", message: "Extracting API routes from files" });

  try {
    const result = await analysisService.analyzeProject(projectId);
    updateJob(job.id, {
      status: "completed",
      message: "Analysis complete",
      completedAt: new Date().toISOString(),
      result,
    });

    res.status(201).json({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Analysis failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    req.log.error({ err }, "Analysis failed");
    res.status(500).json({ error: "Analysis failed", message: String(err) });
  }
}

export async function listApisHandler(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const apis = await analysisService.getApisByProject(projectId);
  res.json({ apis });
}
