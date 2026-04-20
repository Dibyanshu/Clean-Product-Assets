import { type Request, type Response } from "express";
import { z } from "zod";
import * as ingestionService from "../service/ingestion.service.js";
import { createJob, updateJob } from "../../../utils/jobTracker.js";

const IngestBodySchema = z.object({
  repoUrl: z.string().url("repoUrl must be a valid URL"),
});

export async function ingestHandler(req: Request, res: Response): Promise<void> {
  const parsed = IngestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const { repoUrl } = parsed.data;
  const job = createJob("ingestion");

  req.log.info({ jobId: job.id, repoUrl }, "Ingestion job started");
  updateJob(job.id, { status: "running", message: "Cloning and reading repository" });

  try {
    const result = await ingestionService.ingestRepository(repoUrl);
    updateJob(job.id, {
      status: "completed",
      message: "Ingestion complete",
      completedAt: new Date().toISOString(),
      result,
    });

    res.status(201).json({ jobId: job.id, ...result });
  } catch (err) {
    updateJob(job.id, {
      status: "failed",
      message: "Ingestion failed",
      completedAt: new Date().toISOString(),
      error: String(err),
    });
    req.log.error({ err }, "Ingestion failed");
    res.status(500).json({ error: "Ingestion failed", message: String(err) });
  }
}

export async function listProjectsHandler(_req: Request, res: Response): Promise<void> {
  const projects = await ingestionService.listAllProjects();
  res.json({ projects });
}

export async function getProjectHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const project = await ingestionService.getProject(id);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(project);
}
