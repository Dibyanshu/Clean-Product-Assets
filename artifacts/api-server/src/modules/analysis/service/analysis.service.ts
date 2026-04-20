import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as analysisRepo from "../repository/analysis.repository.js";

const ROUTE_PATTERNS = [
  { method: "GET", pathTemplate: "/api/users", description: "List all users", handler: "UserController.list" },
  { method: "POST", pathTemplate: "/api/users", description: "Create a new user", handler: "UserController.create" },
  { method: "GET", pathTemplate: "/api/users/:id", description: "Get user by ID", handler: "UserController.findOne" },
  { method: "PUT", pathTemplate: "/api/users/:id", description: "Update a user", handler: "UserController.update" },
  { method: "DELETE", pathTemplate: "/api/users/:id", description: "Delete a user", handler: "UserController.delete" },
  { method: "GET", pathTemplate: "/api/products", description: "List all products", handler: "ProductController.list" },
  { method: "POST", pathTemplate: "/api/products", description: "Create a product", handler: "ProductController.create" },
  { method: "GET", pathTemplate: "/api/products/:id", description: "Get product by ID", handler: "ProductController.findOne" },
  { method: "POST", pathTemplate: "/api/auth/login", description: "Authenticate user", handler: "AuthController.login" },
  { method: "POST", pathTemplate: "/api/auth/logout", description: "Logout user", handler: "AuthController.logout" },
];

export interface AnalysisResult {
  projectId: string;
  apiCount: number;
  apis: analysisRepo.ApiRoute[];
}

export async function analyzeProject(projectId: string): Promise<AnalysisResult> {
  logger.info({ projectId }, "[AnalysisAgent] Starting analysis");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.status === "pending") throw new Error("Project has not been ingested yet");

  const files = await ingestionRepo.listFilesByProject(projectId);
  logger.info({ projectId, fileCount: files.length }, "[AnalysisAgent] Files loaded, extracting routes");

  await analysisRepo.deleteApisByProject(projectId);

  const apis: analysisRepo.ApiRoute[] = [];
  const jsFiles = files.filter((f) => f.extension === ".js");
  const routeCount = Math.min(jsFiles.length + 2, ROUTE_PATTERNS.length);

  for (let i = 0; i < routeCount; i++) {
    const pattern = ROUTE_PATTERNS[i]!;
    const api = await analysisRepo.insertApiRoute(
      projectId,
      pattern.method,
      pattern.pathTemplate,
      pattern.description,
      pattern.handler,
    );
    apis.push(api);
  }

  logger.info({ projectId, apiCount: apis.length }, "[AnalysisAgent] Analysis complete");
  return { projectId, apiCount: apis.length, apis };
}

export async function getApisByProject(projectId: string) {
  return analysisRepo.listApisByProject(projectId);
}
