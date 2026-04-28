import { logger } from "../lib/logger.js";
import fs from "fs";
import path from "path";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 4096;
const SYSTEM_INSTRUCTIONS = "You are a software architecture analyst. Always respond with valid JSON only. No markdown, no prose.";

interface LlmContext {
  promptName: string;
  promptVersion: string;
  projectId: string;
  apiId?: string;
  maxTokens?: number;
}

let _openai: unknown = null;

import { openai as openaiInstance } from "@workspace/integrations-openai-ai-server";
// Workaround: use 'any' type for openai to avoid type errors from missing type declarations
const openai: any = openaiInstance;

let envLoaded = false;

function loadLocalEnv(): void {
  if (envLoaded || process.env.OPENAI_API_KEY) {
    envLoaded = true;
    return;
  }

  const candidates = [
    path.resolve(process.cwd(), ".env.development"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "artifacts/api-server/.env.development"),
    path.resolve(process.cwd(), "artifacts/api-server/.env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    logger.info({ envPath }, "[LLMService] Local env loaded");
    break;
  }

  envLoaded = true;
}

async function getClient() {
  loadLocalEnv();
  return openai;
}

function extractChatContent(response: any): string {
  const message = response?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("");
  }

  return "";
}

function extractResponsesContent(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text;

  if (Array.isArray(response?.output)) {
    return response.output
      .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .map((part: any) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("");
  }

  return "";
}

export async function generate(prompt: string, ctx: LlmContext): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({ ...ctx, attempt }, "[LLMService] Sending request");

    try {
      const client = await getClient();

      const result = await Promise.race<string>([
        (async () => {
          if (client.responses?.create) {
            const response = await client.responses.create({
              model: "gpt-5-mini",
              instructions: SYSTEM_INSTRUCTIONS,
              input: prompt,
              max_output_tokens: ctx.maxTokens ?? 2048,
            });

            const text = extractResponsesContent(response);
            if (text.trim()) return text;

            logger.warn(
              { ...ctx, attempt, status: response?.status, incompleteDetails: response?.incomplete_details },
              "[LLMService] Responses API returned empty text, falling back to chat completions",
            );
          }

          const response = await client.chat.completions.create({
            model: "gpt-5-mini",
            max_completion_tokens: ctx.maxTokens ?? 2048,
            messages: [
              { role: "system", content: SYSTEM_INSTRUCTIONS },
              { role: "user", content: prompt },
            ],
          });

          const text = extractChatContent(response);
          if (!text.trim()) {
            logger.warn(
              {
                ...ctx,
                attempt,
                finishReason: response?.choices?.[0]?.finish_reason,
                usage: response?.usage,
              },
              "[LLMService] Chat completions returned empty text",
            );
          }

          return text;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`LLM timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
        ),
      ]);

      if (!result || result.trim().length === 0) {
        throw new Error("Empty response from LLM");
      }

      if (result.length > MAX_RESPONSE_CHARS) {
        throw new Error(`Response too large: ${result.length} chars (max ${MAX_RESPONSE_CHARS})`);
      }

      logger.info({ ...ctx, attempt, responseLength: result.length }, "[LLMService] Response received");
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ ...ctx, attempt, error: lastError.message }, "[LLMService] Attempt failed");
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError ?? new Error("LLM generation failed after retries");
}

function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export interface LlmRouteQueryPlanOutput {
  queries: string[];
}

export function parseRouteQueryPlanOutput(raw: string): LlmRouteQueryPlanOutput {
  const stripped = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON from analysis query planner LLM: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Analysis query planner LLM returned non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj["queries"])) {
    throw new Error('Analysis query planner LLM output missing "queries" array');
  }

  const queries: string[] = [];
  const seen = new Set<string>();
  for (const q of obj["queries"] as unknown[]) {
    if (typeof q !== "string") continue;
    const normalized = q.trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (normalized.length < 3 || seen.has(key)) continue;
    seen.add(key);
    queries.push(normalized);
  }

  if (queries.length === 0) {
    throw new Error("Analysis query planner LLM returned no valid queries");
  }

  return { queries };
}

export interface LlmAnalysisRoute {
  method: string;
  path: string;
  description: string | null;
  handler: string | null;
}

export interface LlmAnalysisRouteOutput {
  apis: LlmAnalysisRoute[];
}

export function parseAnalysisRoutesOutput(raw: string): LlmAnalysisRouteOutput {
  const stripped = stripJsonFences(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON from analysis route extraction LLM: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Analysis route extraction LLM returned non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj["apis"])) {
    throw new Error('Analysis route extraction LLM output missing "apis" array');
  }

  const validMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
  const apis: LlmAnalysisRoute[] = [];
  const seen = new Set<string>();

  for (const item of obj["apis"] as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const route = item as Record<string, unknown>;
    const method = typeof route["method"] === "string" ? route["method"].trim().toUpperCase() : "";
    const path = typeof route["path"] === "string" ? route["path"].trim() : "";
    if (!validMethods.has(method) || !path.startsWith("/") || path.length < 2) continue;

    const normalizedPath = path.replace(/\{([^}]+)\}/g, ":$1").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    const key = `${method} ${normalizedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const description = typeof route["description"] === "string" && route["description"].trim()
      ? route["description"].trim()
      : null;
    const handler = typeof route["handler"] === "string" && route["handler"].trim()
      ? route["handler"].trim()
      : null;

    apis.push({ method, path: normalizedPath, description, handler });
  }

  if (apis.length === 0) {
    throw new Error("Analysis route extraction LLM returned no valid routes");
  }

  return { apis };
}

export interface LlmPrdSection {
  title: string;
  content: string;
}

export interface LlmPrdOutput {
  title: string;
  overview: string;
  sections: LlmPrdSection[];
}

export function parsePrdOutput(raw: string): LlmPrdOutput {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON from PRD LLM: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("PRD LLM returned non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;

  const title = typeof obj["title"] === "string" && obj["title"].trim() ? obj["title"].trim() : null;
  const overview = typeof obj["overview"] === "string" ? obj["overview"].trim() : "";

  if (!title) throw new Error('PRD LLM output missing "title" string');

  const sections: LlmPrdSection[] = [];
  if (Array.isArray(obj["sections"])) {
    for (const s of obj["sections"] as unknown[]) {
      if (typeof s !== "object" || s === null) continue;
      const sec = s as Record<string, unknown>;
      const secTitle = typeof sec["title"] === "string" ? sec["title"].trim() : null;
      const secContent = typeof sec["content"] === "string" ? sec["content"].trim() : "";
      if (secTitle && secContent) sections.push({ title: secTitle, content: secContent });
    }
  }

  if (sections.length === 0) throw new Error("PRD LLM returned no valid sections");

  return { title, overview, sections };
}

export interface LlmLineageOutput {
  tables: Array<{ name: string; operation: string }>;
  flow: string[];
}

export function parseLineageOutput(raw: string): LlmLineageOutput {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON from LLM: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM returned non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj["tables"])) {
    throw new Error('LLM output missing "tables" array');
  }

  const tables: Array<{ name: string; operation: string }> = [];
  const VALID_OPS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "QUERY"]);

  for (const t of obj["tables"] as unknown[]) {
    if (typeof t !== "object" || t === null) continue;
    const entry = t as Record<string, unknown>;
    const name = typeof entry["name"] === "string" ? entry["name"].toLowerCase().trim() : null;
    const op = typeof entry["operation"] === "string" ? entry["operation"].toUpperCase().trim() : null;
    if (name && op && VALID_OPS.has(op) && name.length > 1 && /^[a-z_][a-z0-9_]*$/.test(name)) {
      tables.push({ name, operation: op });
    }
  }

  const flow: string[] = [];
  if (Array.isArray(obj["flow"])) {
    for (const f of obj["flow"] as unknown[]) {
      if (typeof f === "string" && f.trim()) flow.push(f.trim());
    }
  }

  return { tables, flow };
}

export interface LlmHldModule {
  name: string;
  apis: string[];
  tables: string[];
}

export interface LlmHldOutput {
  overview: string;
  modules: LlmHldModule[];
  dataFlow: string[];
  architecture: string;
}

export function parseHldOutput(raw: string): LlmHldOutput {
  const stripped = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Invalid JSON from HLD LLM: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("HLD LLM returned non-object JSON");
  }

  const obj = parsed as Record<string, unknown>;

  const overview = typeof obj["overview"] === "string" ? obj["overview"].trim() : "";
  const architecture = typeof obj["architecture"] === "string" ? obj["architecture"].trim() : "";

  const dataFlow: string[] = [];
  if (Array.isArray(obj["dataFlow"])) {
    for (const f of obj["dataFlow"] as unknown[]) {
      if (typeof f === "string" && f.trim()) dataFlow.push(f.trim());
    }
  }

  const modules: LlmHldModule[] = [];
  if (Array.isArray(obj["modules"])) {
    for (const m of obj["modules"] as unknown[]) {
      if (typeof m !== "object" || m === null) continue;
      const mod = m as Record<string, unknown>;
      const name = typeof mod["name"] === "string" ? mod["name"].trim() : null;
      if (!name) continue;

      const apis: string[] = [];
      if (Array.isArray(mod["apis"])) {
        for (const a of mod["apis"] as unknown[]) {
          if (typeof a === "string" && a.trim()) apis.push(a.trim());
        }
      }

      const tables: string[] = [];
      if (Array.isArray(mod["tables"])) {
        for (const t of mod["tables"] as unknown[]) {
          if (typeof t === "string" && t.trim()) {
            const normalized = t.trim().toLowerCase();
            if (/^[a-z_][a-z0-9_]*$/.test(normalized)) tables.push(normalized);
          }
        }
      }

      if (apis.length > 0 || tables.length > 0) {
        modules.push({ name, apis, tables });
      }
    }
  }

  if (modules.length === 0) {
    throw new Error("HLD LLM returned no valid modules");
  }

  return { overview, modules, dataFlow, architecture };
}
