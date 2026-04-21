import { logger } from "../lib/logger.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 4096;

interface LlmContext {
  promptName: string;
  promptVersion: string;
  projectId: string;
  apiId?: string;
  maxTokens?: number;
}

let _openai: unknown = null;

async function getClient() {
  if (_openai) return _openai as import("openai").default;
  const { openai } = await import("@workspace/integrations-openai-ai-server");
  _openai = openai;
  return openai;
}

export async function generate(prompt: string, ctx: LlmContext): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({ ...ctx, attempt }, "[LLMService] Sending request");

    try {
      const client = await getClient();

      const result = await Promise.race<string>([
        (async () => {
          const response = await (client as import("openai").default).chat.completions.create({
            model: "gpt-5-mini",
            max_completion_tokens: ctx.maxTokens ?? 1024,
            messages: [
              {
                role: "system",
                content:
                  "You are a software architecture analyst. Always respond with valid JSON only. No markdown, no prose.",
              },
              { role: "user", content: prompt },
            ],
          });
          return response.choices[0]?.message?.content ?? "";
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
