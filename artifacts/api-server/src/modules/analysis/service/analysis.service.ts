import { logger } from "../../../lib/logger.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as analysisRepo from "../repository/analysis.repository.js";
import * as chroma from "../../../services/chroma.service.js";
import * as llmService from "../../../services/llm.service.js";
import * as promptService from "../../../services/prompt.service.js";

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

const MAX_ANALYSIS_QUERIES = 20;
const CHROMA_RESULTS_PER_QUERY = 4;
const MAX_CONTEXT_CHUNKS = 20;

export interface AnalysisResult {
  projectId: string;
  apiCount: number;
  apis: analysisRepo.ApiRoute[];
  semanticContext?: string[];
}

function normalizeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const query of queries) {
    const q = query.trim().replace(/\s+/g, " ");
    const key = q.toLowerCase();
    if (q.length < 3 || seen.has(key)) continue;
    seen.add(key);
    normalized.push(q);
    if (normalized.length >= MAX_ANALYSIS_QUERIES) break;
  }

  return normalized;
}

function dedupeChunks(chunks: chroma.SearchResult[]): chroma.SearchResult[] {
  const seen = new Set<string>();
  const deduped: chroma.SearchResult[] = [];

  for (const chunk of chunks) {
    const file = chunk.metadata.file ?? "unknown";
    const key = `${file}::${chunk.content.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(chunk);
    if (deduped.length >= MAX_CONTEXT_CHUNKS) break;
  }

  return deduped;
}

async function insertDeterministicRoutes(
  projectId: string,
  files: ingestionRepo.ProjectFile[],
): Promise<analysisRepo.ApiRoute[]> {
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

  return apis;
}

export async function analyzeProject(projectId: string): Promise<AnalysisResult> {
  logger.info({ projectId }, "[AnalysisAgent] Starting analysis");

  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (project.status === "pending") throw new Error("Project has not been ingested yet");

  const files = await ingestionRepo.listFilesByProject(projectId);
  logger.info({ projectId, fileCount: files.length }, "[AnalysisAgent] Files loaded, extracting routes");

  const semanticContext: string[] = [];
  let extractedRoutes: llmService.LlmAnalysisRoute[] | null = null;

  try {
    debugger;
    const queryPrompt = promptService.buildAnalysisQueryPlanningPrompt({
      projectName: project.name,
      files: files.map((f) => ({
        path: f.path,
        extension: f.extension,
        sizeBytes: f.size_bytes,
      })),
    });

    const rawQueryPlan = await llmService.generate(queryPrompt.text, {
      promptName: "analysis_query_planning",
      promptVersion: queryPrompt.version,
      projectId,
      maxTokens: 1800,
    });

    const queryPlan = llmService.parseRouteQueryPlanOutput(rawQueryPlan);
    const contextQueries = normalizeQueries(queryPlan.queries);
    if (contextQueries.length === 0) {
      throw new Error("Analysis query planner produced no executable queries");
    }

    logger.info({ projectId, queryCount: contextQueries.length }, "[AnalysisAgent] LLM query plan generated");

    const rawChunks: chroma.SearchResult[] = [];
    for (const query of contextQueries) {
      const hits = chroma.queryDocuments(projectId, query, CHROMA_RESULTS_PER_QUERY);
      if (hits.length > 0) {
        logger.info({ projectId, query, hits: hits.length }, "[AnalysisAgent] Semantic context retrieved");
        rawChunks.push(...hits);
      }
    }

    const chunks = dedupeChunks(rawChunks);
    for (const h of chunks) {
      semanticContext.push(`[${h.metadata.file ?? "unknown"} score=${h.score}] ${h.content.slice(0, 120)}`);
    }

    logger.info({ projectId, contextChunks: chunks.length }, "[AnalysisAgent] Context injected into analysis");

    if (chunks.length === 0) {
      throw new Error("No semantic context retrieved for analysis route extraction");
    }

    const extractionPrompt = promptService.buildAnalysisRouteExtractionPrompt({
      chunks: chunks.map((c) => ({
        content: c.content,
        file: c.metadata.file,
        type: c.metadata.type,
      })),
    });

    const rawRoutes = await llmService.generate(extractionPrompt.text, {
      promptName: "analysis_route_extraction",
      promptVersion: extractionPrompt.version,
      projectId,
      maxTokens: 1600,
    });

    extractedRoutes = llmService.parseAnalysisRoutesOutput(rawRoutes).apis;
    logger.info({ projectId, apiCount: extractedRoutes.length }, "[AnalysisAgent] LLM routes extracted");
  } catch (err) {
    logger.warn({ projectId, err: String(err) }, "[AnalysisAgent] LLM route extraction failed, using deterministic fallback");
  }

  await analysisRepo.deleteApisByProject(projectId);

  const apis: analysisRepo.ApiRoute[] = [];
  if (extractedRoutes && extractedRoutes.length > 0) {
    for (const route of extractedRoutes) {
      const api = await analysisRepo.insertApiRoute(
        projectId,
        route.method,
        route.path,
        route.description,
        route.handler,
      );
      apis.push(api);
    }
    logger.info({ projectId, apiCount: apis.length, source: "llm" }, "[AnalysisAgent] Analysis complete");
  } else {
    apis.push(...await insertDeterministicRoutes(projectId, files));
    logger.info({ projectId, apiCount: apis.length, source: "deterministic_fallback" }, "[AnalysisAgent] Analysis complete");
  }

  return { projectId, apiCount: apis.length, apis, semanticContext };
}

export async function getApisByProject(projectId: string) {
  return analysisRepo.listApisByProject(projectId);
}
