import { logger } from "../lib/logger.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 4096;

interface LlmContext {
  promptName: string;
  promptVersion: string;
  projectId: string;
  apiId: string;
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
            max_completion_tokens: 1024,
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
