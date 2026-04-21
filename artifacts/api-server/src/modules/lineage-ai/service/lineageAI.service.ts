import { logger } from "../../../lib/logger.js";
import * as lineageRepo from "../../lineage/repository/lineage.repository.js";
import * as analysisRepo from "../../analysis/repository/analysis.repository.js";
import * as dbSchemaRepo from "../../db-schema/repository/dbSchema.repository.js";
import * as chroma from "../../../services/chroma.service.js";
import * as llmService from "../../../services/llm.service.js";
import * as promptService from "../../../services/prompt.service.js";
import * as cacheService from "../../../services/cache.service.js";

export interface AITableRef {
  name: string;
  operation: string;
  confidence: "high" | "medium" | "low" | "conflict";
  source: "deterministic" | "llm" | "merged";
  prompt_version: string;
}

export interface AILineageResult {
  api: string;
  apiId: string;
  method: string;
  path: string;
  tables: AITableRef[];
  flow: string[];
  source: "deterministic" | "llm" | "merged";
  promptVersion: string;
  cached: boolean;
}

export interface BulkAILineageResult {
  projectId: string;
  processed: number;
  enhanced: number;
  fallback: number;
  results: AILineageResult[];
}

async function buildSchemaContext(projectId: string): Promise<string> {
  try {
    const tables = await dbSchemaRepo.getTablesForProject(projectId);
    if (!tables || tables.length === 0) return "(schema not extracted yet)";
    return tables
      .slice(0, 20)
      .map((t) => `TABLE: ${t.name}`)
      .join("\n");
  } catch {
    return "(schema unavailable)";
  }
}

async function runRagForApi(
  projectId: string,
  api: { id: string; method: string; path: string; handler: string | null },
  deterministicTables: lineageRepo.ApiTableMap[],
): Promise<AILineageResult> {
  const handlerName = api.handler ?? `${api.method} ${api.path}`;

  // --- RAG: retrieve top 8 relevant chunks ---
  const queryTerms = [api.path, handlerName, api.method.toLowerCase(), "database", "sql", "query"].join(" ");
  const rawChunks = chroma.queryDocuments(projectId, queryTerms, 10);

  // Deduplicate by content fingerprint (first 80 chars)
  const seen = new Set<string>();
  const chunks = rawChunks.filter((c) => {
    const key = c.content.slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  logger.info({ projectId, apiId: api.id, chunkCount: chunks.length }, "[LineageAI] Retrieved chunks");

  const schemaText = await buildSchemaContext(projectId);

  const deterministicRefs = deterministicTables.map((t) => ({
    name: t.table_name,
    operation: t.operation as lineageRepo.SqlOperation,
    confidence: t.confidence,
  }));

  const { text: promptText, version: promptVersion } = promptService.buildLineagePrompt({
    method: api.method,
    path: api.path,
    handler: api.handler,
    chunks: chunks.map((c) => ({
      content: c.content,
      file: (c.metadata.file as string | undefined) ?? "unknown",
      type: (c.metadata.type as string | undefined) ?? "code",
    })),
    schemaText,
    deterministicTables: deterministicRefs,
  });

  const cKey = cacheService.cacheKey(projectId, api.id, promptVersion);
  const cached = cacheService.get<AILineageResult>(cKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // --- LLM call ---
  let llmOutput: llmService.LlmLineageOutput | null = null;
  try {
    const raw = await llmService.generate(promptText, {
      promptName: "lineage_analysis",
      promptVersion,
      projectId,
      apiId: api.id,
    });
    llmOutput = llmService.parseLineageOutput(raw);
    logger.info({ projectId, apiId: api.id, tableCount: llmOutput.tables.length }, "[LineageAI] LLM output validated");
  } catch (err) {
    logger.warn({ projectId, apiId: api.id, err: String(err) }, "[LineageAI] LLM failed, using deterministic fallback");
  }

  // --- Merge deterministic + LLM ---
  const mergedMap = new Map<
    string,
    { name: string; operation: string; confidence: lineageRepo.ConfidenceLevel; source: "deterministic" | "llm" | "merged" }
  >();

  // Seed with deterministic results
  for (const t of deterministicTables) {
    const key = `${t.table_name}::${t.operation}`;
    mergedMap.set(key, {
      name: t.table_name,
      operation: t.operation,
      confidence: lineageRepo.confidenceLevelFromFloat(t.confidence),
      source: "deterministic",
    });
  }

  if (llmOutput) {
    for (const llmTable of llmOutput.tables) {
      const exactKey = `${llmTable.name}::${llmTable.operation}`;
      const conflictKey = [...mergedMap.keys()].find(
        (k) => k.startsWith(`${llmTable.name}::`) && !k.endsWith(`::${llmTable.operation}`),
      );

      if (mergedMap.has(exactKey)) {
        // LLM confirms deterministic → merged, high confidence
        mergedMap.set(exactKey, { ...mergedMap.get(exactKey)!, source: "merged", confidence: "high" });
      } else if (conflictKey) {
        // Same table, different operation → conflict
        mergedMap.set(conflictKey, { ...mergedMap.get(conflictKey)!, confidence: "conflict" });
        // Add LLM's version too
        mergedMap.set(exactKey, { name: llmTable.name, operation: llmTable.operation, confidence: "conflict", source: "llm" });
      } else {
        // LLM found something new
        mergedMap.set(exactKey, { name: llmTable.name, operation: llmTable.operation, confidence: "low", source: "llm" });
      }
    }
  }

  const tables: AITableRef[] = [...mergedMap.values()].map((t) => ({
    ...t,
    prompt_version: promptVersion,
  }));

  const flow =
    llmOutput && llmOutput.flow.length > 0
      ? llmOutput.flow
      : [handlerName, ...(deterministicTables.length > 0 ? ["[deterministic]"] : ["[no mapping]"])];

  const overallSource: "deterministic" | "llm" | "merged" =
    !llmOutput
      ? "deterministic"
      : tables.some((t) => t.source === "merged")
        ? "merged"
        : tables.every((t) => t.source === "llm")
          ? "llm"
          : "merged";

  // --- Persist to DB ---
  await lineageRepo.clearApiTableMapForApi(projectId, api.id);
  for (const t of tables) {
    const floatConf = t.confidence === "high" ? 0.9 : t.confidence === "medium" ? 0.7 : t.confidence === "conflict" ? 0.5 : 0.4;
    await lineageRepo.insertApiTableMap(projectId, api.id, t.name, t.operation as lineageRepo.SqlOperation, floatConf, {
      source: t.source,
      confidence_level: t.confidence,
      prompt_version: promptVersion,
    });
  }

  const result: AILineageResult = {
    api: `${api.method} ${api.path}`,
    apiId: api.id,
    method: api.method,
    path: api.path,
    tables,
    flow,
    source: overallSource,
    promptVersion,
    cached: false,
  };

  cacheService.set(cKey, result);
  return result;
}

export async function enhanceSingle(projectId: string, apiId: string): Promise<AILineageResult> {
  const apis = await analysisRepo.listApisByProject(projectId);
  const api = apis.find((a) => a.id === apiId);
  if (!api) throw new Error(`API not found: ${apiId} in project ${projectId}`);

  const existingTables = await lineageRepo.getApiTableMapsForApi(projectId, apiId);
  return runRagForApi(projectId, api, existingTables);
}

export async function enhanceBulk(projectId: string): Promise<BulkAILineageResult> {
  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) {
    return { projectId, processed: 0, enhanced: 0, fallback: 0, results: [] };
  }

  const allTableMaps = await lineageRepo.getApiTableMaps(projectId);
  const results: AILineageResult[] = [];
  let enhanced = 0;
  let fallback = 0;

  for (const api of apis) {
    const deterministicTables = allTableMaps.filter((m) => m.api_id === api.id);
    try {
      const result = await runRagForApi(projectId, api, deterministicTables);
      results.push(result);
      if (result.source !== "deterministic") enhanced++;
      else fallback++;
    } catch (err) {
      logger.warn({ projectId, apiId: api.id, err: String(err) }, "[LineageAI] Bulk: skipping failed API");
      fallback++;
    }
    // Rate-limit: 300ms between calls
    await new Promise((r) => setTimeout(r, 300));
  }

  return { projectId, processed: apis.length, enhanced, fallback, results };
}

export async function refreshCache(projectId: string): Promise<{ evicted: number }> {
  const evicted = cacheService.invalidateProject(projectId);
  logger.info({ projectId, evicted }, "[LineageAI] Cache refreshed");
  return { evicted };
}
