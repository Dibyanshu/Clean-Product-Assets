import { type Request, type Response } from "express";
import { z } from "zod";
import * as prdService from "../service/prd.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const GeneratePRDBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

export async function generatePRDHandler(req: Request, res: Response): Promise<void> {
  const parsed = GeneratePRDBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { projectId } = parsed.data;
  const job = createJob("prd-generator", projectId);

  req.log.info({ jobId: job.id, projectId }, "PRD generation job started");
  updateJob(job.id, { status: "running", message: "Generating PRD via LLM" });

  try {
    const result = await prdService.generateProjectPRD(projectId);
    updateJob(job.id, {
      status: "completed",
      message: "PRD generation complete",
      completedAt: new Date().toISOString(),
      result,
    });

    res.status(201).json({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "PRD generation failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    req.log.error({ err }, "PRD generation failed");
    res.status(500).json({ error: "PRD generation failed", message: String(err) });
  }
}

export async function listDocumentsHandler(req: Request, res: Response): Promise<void> {
  const { projectId } = req.params as { projectId: string };
  const documents = await prdService.getDocumentsByProject(projectId);
  res.json({ documents });
}
