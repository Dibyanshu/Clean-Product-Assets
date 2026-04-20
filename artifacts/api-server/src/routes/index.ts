import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import agentRouter from "./agent.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentRouter);

export default router;
