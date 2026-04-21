import { logger } from "../../../lib/logger.js";
import * as analysisRepo from "../../analysis/repository/analysis.repository.js";
import * as lineageRepo from "../../lineage/repository/lineage.repository.js";
import * as dbSchemaRepo from "../../db-schema/repository/dbSchema.repository.js";
import * as prdRepo from "../../prd/repository/prd.repository.js";
import * as chroma from "../../../services/chroma.service.js";
import * as llmService from "../../../services/llm.service.js";
import * as promptService from "../../../services/prompt.service.js";

const HLD_DOC_TYPE = "hld";

export interface HldModule {
  name: string;
  apis: string[];
  tables: string[];
}

export interface HldDocument {
  id: string;
  projectId: string;
  overview: string;
  modules: HldModule[];
  dataFlow: string[];
  architecture: string;
  promptVersion: string;
  createdAt: string;
}

async function buildLineageText(projectId: string): Promise<{ text: string; apiCount: number }> {
  const apis = await analysisRepo.listApisByProject(projectId);
  const tableMaps = await lineageRepo.getApiTableMaps(projectId);

  if (apis.length === 0) return { text: "(no APIs extracted yet)", apiCount: 0 };

  const apiMap = new Map(apis.map((a) => [a.id, a]));
  const byApi = new Map<string, { method: string; path: string; tables: string[] }>();

  for (const tm of tableMaps) {
    const api = apiMap.get(tm.api_id);
    if (!api) continue;
    const key = tm.api_id;
    if (!byApi.has(key)) {
      byApi.set(key, { method: api.method, path: api.path, tables: [] });
    }
    const entry = byApi.get(key)!;
    const tableStr = `${tm.table_name} (${tm.operation})`;
    if (!entry.tables.includes(tableStr)) entry.tables.push(tableStr);
  }

  const lines: string[] = [];
  for (const api of apis.slice(0, 30)) {
    const entry = byApi.get(api.id);
    const tables = entry?.tables.join(", ") || "(no table mapping yet)";
    lines.push(`  ${api.method} ${api.path} → ${tables}`);
  }

  logger.info({ projectId, apiCount: apis.length, lineageRows: tableMaps.length }, "[HLD] Lineage aggregated");
  return { text: lines.join("\n"), apiCount: apis.length };
}

async function buildSchemaText(projectId: string): Promise<string> {
  try {
    const tables = await dbSchemaRepo.getTablesForProject(projectId);
    if (!tables || tables.length === 0) return "(schema not extracted yet)";
    return tables
      .slice(0, 25)
      .map((t) => `TABLE: ${t.name}`)
      .join("\n");
  } catch {
    return "(schema unavailable)";
  }
}

function buildDeterministicHld(
  apis: Array<{ id: string; method: string; path: string }>,
  tableMaps: Array<{ api_id: string; table_name: string; operation: string }>,
  schemaTableNames: string[],
): llmService.LlmHldOutput {
  // Group APIs by first meaningful path segment (e.g. /api/users/... → "users")
  const moduleMap = new Map<string, { apis: Array<{ id: string; method: string; path: string }>; tables: Set<string> }>();

  for (const api of apis) {
    const segments = api.path.replace(/^\/+/, "").split("/").filter(Boolean);
    // Skip generic prefixes like "api", "v1", "v2"
    let groupKey =
      segments.find((s) => !/^(api|v\d+|rest|service)$/i.test(s)) ??
      segments[0] ??
      "core";
    // strip leading colon or brace params
    groupKey = groupKey.replace(/^[:{}]/, "").replace(/[{}]/g, "").toLowerCase();
    if (!groupKey) groupKey = "core";

    if (!moduleMap.has(groupKey)) {
      moduleMap.set(groupKey, { apis: [], tables: new Set() });
    }
    moduleMap.get(groupKey)!.apis.push(api);
  }

  // Map tables to modules via lineage
  const apiToGroup = new Map<string, string>();
  for (const api of apis) {
    const segments = api.path.replace(/^\/+/, "").split("/").filter(Boolean);
    let groupKey =
      segments.find((s) => !/^(api|v\d+|rest|service)$/i.test(s)) ??
      segments[0] ??
      "core";
    groupKey = groupKey.replace(/^[:{}]/, "").replace(/[{}]/g, "").toLowerCase();
    if (!groupKey) groupKey = "core";
    apiToGroup.set(api.id, groupKey);
  }

  for (const tm of tableMaps) {
    const group = apiToGroup.get(tm.api_id);
    if (group && moduleMap.has(group)) {
      moduleMap.get(group)!.tables.add(tm.table_name.toLowerCase());
    }
  }

  const modules: llmService.LlmHldModule[] = [];
  for (const [key, { apis: modApis, tables }] of moduleMap) {
    const name = key.charAt(0).toUpperCase() + key.slice(1) + " Module";
    const apiLabels = modApis.slice(0, 20).map((a) => `${a.method} ${a.path}`);
    modules.push({ name, apis: apiLabels, tables: Array.from(tables) });
  }

  if (modules.length === 0) {
    modules.push({ name: "Core Module", apis: apis.slice(0, 10).map((a) => `${a.method} ${a.path}`), tables: schemaTableNames.slice(0, 5) });
  }

  const tableList = schemaTableNames.slice(0, 10).join(", ") || "none detected";
  const dataFlow = [
    `Client sends HTTP request to one of ${apis.length} endpoints`,
    `API layer routes request to appropriate handler`,
    `Handler reads/writes data in the database (${tableList})`,
    `Response serialized and returned to client`,
  ];

  return {
    overview: `System with ${apis.length} API endpoints grouped into ${modules.length} module(s). Data persisted in ${schemaTableNames.length} table(s) (${tableList}). This HLD was generated deterministically from extracted lineage data.`,
    modules,
    dataFlow,
    architecture: "Layered (HTTP → Handler → DB)",
  };
}

async function buildContextText(projectId: string): Promise<{ text: string; chunkCount: number }> {
  const queries = ["authentication logic", "order processing", "user management", "data access", "business logic"];
  const seen = new Set<string>();
  const chunks: string[] = [];

  for (const q of queries) {
    const results = chroma.queryDocuments(projectId, q, 4);
    for (const r of results) {
      const key = r.content.slice(0, 80);
      if (!seen.has(key)) {
        seen.add(key);
        const file = (r.metadata.file as string | undefined) ?? "unknown";
        chunks.push(`[${file}]\n${r.content.slice(0, 350)}`);
        if (chunks.length >= 10) break;
      }
    }
    if (chunks.length >= 10) break;
  }

  logger.info({ projectId, chunkCount: chunks.length }, "[HLD] Context chunks retrieved");
  return {
    text: chunks.length > 0 ? chunks.join("\n\n---\n\n") : "(no code context available)",
    chunkCount: chunks.length,
  };
}

function postProcess(
  raw: llmService.LlmHldOutput,
  allApis: Array<{ method: string; path: string }>,
): llmService.LlmHldOutput {
  const assignedApis = new Set<string>();
  const cleanModules: llmService.LlmHldModule[] = [];

  for (const mod of raw.modules) {
    const cleanApis = [...new Set(mod.apis.map((a) => a.trim()).filter(Boolean))];
    const cleanTables = [...new Set(mod.tables.map((t) => t.toLowerCase().trim()).filter(Boolean))];

    const deduped = cleanApis.filter((a) => {
      if (assignedApis.has(a)) return false;
      assignedApis.add(a);
      return true;
    });

    if (deduped.length === 0 && cleanTables.length === 0) continue;
    cleanModules.push({ name: mod.name, apis: deduped, tables: cleanTables });
  }

  const unassigned = allApis
    .map((a) => `${a.method} ${a.path}`)
    .filter((label) => !assignedApis.has(label));

  if (unassigned.length > 0) {
    const miscIdx = cleanModules.findIndex((m) => m.name.toLowerCase().includes("misc") || m.name.toLowerCase().includes("other"));
    if (miscIdx >= 0) {
      cleanModules[miscIdx].apis.push(...unassigned);
    } else {
      cleanModules.push({ name: "Other Endpoints", apis: unassigned, tables: [] });
    }
    logger.info({ unassigned }, "[HLD] Unassigned APIs placed in 'Other Endpoints'");
  }

  const moduleNames = new Set(cleanModules.map((m) => m.name));
  const cleanFlow = raw.dataFlow.filter((f) => typeof f === "string" && f.trim().length > 0);

  return {
    overview: raw.overview || "System overview not available.",
    modules: cleanModules,
    dataFlow: cleanFlow,
    architecture: raw.architecture || "Modular architecture",
  };
}

export async function generateHld(projectId: string): Promise<HldDocument> {
  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) {
    throw new Error("No APIs found for this project. Run analyze first.");
  }

  // Fetch all supporting data in parallel (needed by both LLM and deterministic paths)
  const tableMaps = await lineageRepo.getApiTableMaps(projectId);
  const schemaTables = await dbSchemaRepo.getTablesForProject(projectId).catch(() => []);
  const schemaTableNames = (schemaTables ?? []).map((t) => t.name);

  const [{ text: lineageText, apiCount }, schemaText, { text: contextText, chunkCount }] = await Promise.all([
    buildLineageText(projectId),
    buildSchemaText(projectId),
    buildContextText(projectId),
  ]);

  const { text: promptText, version: promptVersion } = promptService.buildHldPrompt({
    lineageText,
    schemaText,
    contextText,
  });

  logger.info(
    { projectId, apiCount, chunkCount, schemaLen: schemaText.length, lineageLen: lineageText.length, promptVersion },
    "[HLD] Prompt built",
  );

  let processed: llmService.LlmHldOutput;
  let usedFallback = false;

  try {
    const raw = await llmService.generate(promptText, {
      promptName: "hld_analysis",
      promptVersion,
      projectId,
      maxTokens: 2048,
    });

    const rawOutput = llmService.parseHldOutput(raw);
    logger.info({ projectId, rawModules: rawOutput.modules.length }, "[HLD] LLM output parsed");
    processed = postProcess(rawOutput, apis.map((a) => ({ method: a.method, path: a.path })));
  } catch (err) {
    logger.warn(
      { projectId, err: String(err) },
      "[HLD] LLM unavailable — using deterministic fallback",
    );
    processed = buildDeterministicHld(apis, tableMaps, schemaTableNames);
    usedFallback = true;
    // Override promptVersion to indicate fallback
    (processed as llmService.LlmHldOutput & { _fallback?: boolean })._fallback = true;
  }

  await prdRepo.deleteDocumentsByProjectAndType(projectId, HLD_DOC_TYPE);

  const effectiveVersion = usedFallback ? "deterministic-v1" : promptVersion;
  const content = JSON.stringify({ ...processed, promptVersion: effectiveVersion });
  const doc = await prdRepo.insertDocument(projectId, HLD_DOC_TYPE, "High-Level Design", content);

  logger.info(
    { projectId, docId: doc.id, modules: processed.modules.length, dataFlow: processed.dataFlow.length, usedFallback },
    "[HLD] Document stored",
  );

  return {
    id: doc.id,
    projectId,
    overview: processed.overview,
    modules: processed.modules,
    dataFlow: processed.dataFlow,
    architecture: processed.architecture,
    promptVersion: effectiveVersion,
    createdAt: doc.created_at,
  };
}

export async function getHld(projectId: string): Promise<HldDocument | null> {
  const doc = await prdRepo.findLatestDocumentByProjectAndType(projectId, HLD_DOC_TYPE);
  if (!doc) return null;

  try {
    const parsed = JSON.parse(doc.content) as {
      overview: string;
      modules: HldModule[];
      dataFlow: string[];
      architecture: string;
      promptVersion: string;
    };
    return {
      id: doc.id,
      projectId,
      overview: parsed.overview ?? "",
      modules: parsed.modules ?? [],
      dataFlow: parsed.dataFlow ?? [],
      architecture: parsed.architecture ?? "",
      promptVersion: parsed.promptVersion ?? "v1",
      createdAt: doc.created_at,
    };
  } catch {
    return null;
  }
}

export async function refreshHld(projectId: string): Promise<HldDocument> {
  logger.info({ projectId }, "[HLD] Refresh requested — deleting existing and regenerating");
  await prdRepo.deleteDocumentsByProjectAndType(projectId, HLD_DOC_TYPE);
  return generateHld(projectId);
}
