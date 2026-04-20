import { Router, type IRouter } from "express";
import { ingestHandler, listProjectsHandler, getProjectHandler } from "../modules/ingestion/controller/ingestion.controller.js";
import { analyzeHandler, listApisHandler } from "../modules/analysis/controller/analysis.controller.js";
import { generatePRDHandler, listDocumentsHandler } from "../modules/prd/controller/prd.controller.js";
import { listJobs, getJob } from "../utils/jobTracker.js";

const router: IRouter = Router();

router.post("/agent/ingest", ingestHandler);
router.get("/agent/projects", listProjectsHandler);
router.get("/agent/projects/:id", getProjectHandler);

router.post("/agent/analyze", analyzeHandler);
router.get("/agent/projects/:projectId/apis", listApisHandler);

router.post("/agent/generate-prd", generatePRDHandler);
router.get("/agent/projects/:projectId/documents", listDocumentsHandler);

router.get("/agent/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

router.get("/agent/jobs/:id", (req, res) => {
  const job = getJob((req.params as { id: string }).id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

export default router;
