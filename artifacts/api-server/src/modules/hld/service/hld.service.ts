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

  let rawOutput: llmService.LlmHldOutput | null = null;
  let llmAttempts = 0;
  let validationFailures = 0;

  const raw = await llmService.generate(promptText, {
    promptName: "hld_analysis",
    promptVersion,
    projectId,
    maxTokens: 2048,
  });
  llmAttempts++;

  try {
    rawOutput = llmService.parseHldOutput(raw);
  } catch (err) {
    validationFailures++;
    logger.warn({ projectId, err: String(err) }, "[HLD] LLM output validation failed");
    throw new Error(`HLD generation failed: ${String(err)}`);
  }

  logger.info({ projectId, llmAttempts, validationFailures, rawModules: rawOutput.modules.length }, "[HLD] LLM output parsed");

  const processed = postProcess(rawOutput, apis.map((a) => ({ method: a.method, path: a.path })));

  await prdRepo.deleteDocumentsByProjectAndType(projectId, HLD_DOC_TYPE);

  const content = JSON.stringify({ ...processed, promptVersion });
  const doc = await prdRepo.insertDocument(projectId, HLD_DOC_TYPE, "High-Level Design", content);

  logger.info(
    { projectId, docId: doc.id, modules: processed.modules.length, dataFlow: processed.dataFlow.length },
    "[HLD] Document stored",
  );

  return {
    id: doc.id,
    projectId,
    overview: processed.overview,
    modules: processed.modules,
    dataFlow: processed.dataFlow,
    architecture: processed.architecture,
    promptVersion,
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
