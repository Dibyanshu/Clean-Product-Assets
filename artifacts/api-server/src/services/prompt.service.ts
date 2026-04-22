import type { LineageTableRef } from "../modules/lineage/service/lineage.service.js";

export interface PromptTemplate {
  version: string;
  name: string;
  template: string;
}

export interface LineagePromptInput {
  method: string;
  path: string;
  handler: string | null;
  chunks: Array<{ content: string; file?: string; type?: string }>;
  schemaText: string;
  deterministicTables: LineageTableRef[];
}

const PROMPTS: Record<string, PromptTemplate> = {
  prd_generation_v1: {
    version: "v1",
    name: "prd_generation",
    template: `You are a senior product manager and technical writer.

You have been given the extracted API surface of a legacy codebase named "{projectName}".

API Endpoints ({apiCount} total):
{apiList}

Relevant Code Context:
{context}

Generate a comprehensive Product Requirements Document (PRD) for modernizing this system.

Return STRICT JSON only — no markdown fences, no explanation, no trailing text:
{
  "title": "Product Requirements Document — {projectName}",
  "overview": "Two to four sentence overview of the system and the modernization goals",
  "sections": [
    {
      "title": "Executive Summary",
      "content": "Concise executive summary of the system purpose and modernization scope"
    },
    {
      "title": "API Inventory",
      "content": "Bullet-point list of all endpoints with method, path, and a one-line description of each"
    },
    {
      "title": "Resource Domains",
      "content": "Group endpoints by the resource they operate on (e.g. Users, Orders). For each domain list the routes."
    },
    {
      "title": "HTTP Method Distribution",
      "content": "Summary of how many GET / POST / PUT / PATCH / DELETE endpoints exist and what that implies about the system"
    },
    {
      "title": "Technical Requirements",
      "content": "Bullet-point list of non-functional requirements inferred from the API surface (auth, rate limiting, error format, pagination, etc.)"
    },
    {
      "title": "User Stories",
      "content": "Five to eight user stories written as: As a [role], I want to [action] so that [value]. Derive from the actual endpoints."
    }
  ]
}

Rules:
- Every endpoint from the API Inventory must be mentioned in at least one section
- Section titles must exactly match the six titles above
- Do not add extra sections or rename existing ones
- Use plain text in content fields — no nested JSON`,
  },

  hld_analysis_v1: {
    version: "v1",
    name: "hld_analysis",
    template: `You are a senior system architect.

Given the following system data extracted from a legacy codebase:

API to DB Lineage (which API endpoints touch which database tables):
{lineage}

Database Schema (table names present in the system):
{schema}

Code Context (relevant business logic retrieved from the codebase):
{context}

Generate a High-Level Design (HLD) document. Group APIs logically into services/modules based on the data they access and their naming patterns.

Return STRICT JSON only — no markdown fences, no explanation, no trailing text:
{
  "overview": "One to three sentence system overview describing the main purpose and architecture",
  "modules": [
    {
      "name": "Service or module name (e.g. User Management, Order Service)",
      "apis": ["METHOD /path/to/endpoint", "METHOD /other/endpoint"],
      "tables": ["lowercase_table_name", "another_table"]
    }
  ],
  "dataFlow": [
    "Module A → Module B (reason or data exchanged)"
  ],
  "architecture": "One sentence architecture style recommendation (e.g. Modular Monolith, Microservices, Layered)"
}

Rules:
- Every API endpoint must appear in exactly one module
- Every known table must appear in at least one module if it is referenced in the lineage
- Module names must be descriptive business domain names (not technical names like 'Controller' or 'Repository')
- dataFlow entries must reference actual module names from the modules array
- Do not create empty modules (modules with no apis AND no tables)
- Aim for 3-7 modules for a well-structured design`,
  },

  lineage_analysis_v1: {
    version: "v1",
    name: "lineage_analysis",
    template: `You are a senior software architect analyzing a legacy codebase.

Given the following API endpoint and retrieved code context, identify:
1. Database tables this endpoint reads from or writes to
2. The SQL operation for each table (SELECT, INSERT, UPDATE, DELETE)
3. The execution flow (function call chain from handler to database)

API:
{method} {path}
Handler: {handler}

Retrieved Code Context:
{chunks}

Database Schema:
{schema}

Existing deterministic analysis found these table mappings:
{deterministic}

Return STRICT JSON only — no markdown fences, no explanation, no trailing text:
{
  "tables": [
    { "name": "lowercase_table_name", "operation": "SELECT|INSERT|UPDATE|DELETE" }
  ],
  "flow": ["HandlerFunction", "IntermediateFunction", "dbOperation"]
}

Rules:
- Only include tables that are actually used by this endpoint
- Use lowercase for table names
- Use uppercase for operations
- Flow should reflect actual function call chain (3-5 steps max)
- If uncertain, omit rather than guess`,
  },
};

export function getPrompt(name: string): PromptTemplate {
  const key = `${name}_v1`;
  const prompt = PROMPTS[key];
  if (!prompt) throw new Error(`Prompt template not found: ${name}`);
  return prompt;
}

export function getLatestVersion(name: string): string {
  return getPrompt(name).version;
}

export interface HldPromptInput {
  lineageText: string;
  schemaText: string;
  contextText: string;
}

export function buildHldPrompt(input: HldPromptInput): { text: string; version: string } {
  const key = "hld_analysis_v1";
  const tmpl = PROMPTS[key];
  if (!tmpl) throw new Error("HLD prompt template not found");

  const text = tmpl.template
    .replace("{lineage}", input.lineageText || "  (no lineage data — run generate-lineage first)")
    .replace("{schema}", input.schemaText || "  (no schema extracted)")
    .replace("{context}", input.contextText || "  (no code context available)");

  return { text, version: tmpl.version };
}

export interface PrdPromptInput {
  projectName: string;
  apis: Array<{ method: string; path: string; description: string | null; handler: string | null }>;
  contextChunks: Array<{ content: string; file?: string; type?: string }>;
}

export function buildPrdPrompt(input: PrdPromptInput): { text: string; version: string } {
  const key = "prd_generation_v1";
  const tmpl = PROMPTS[key];
  if (!tmpl) throw new Error("PRD prompt template not found");

  const apiList = input.apis
    .map((a) => `  • [${a.method}] ${a.path}${a.handler ? ` — handler: ${a.handler}` : ""}${a.description ? ` — ${a.description}` : ""}`)
    .join("\n");

  const contextText = input.contextChunks.length > 0
    ? input.contextChunks
        .slice(0, 6)
        .map((c, i) => `[${i + 1}] File: ${c.file ?? "unknown"} (${c.type ?? "code"})\n${c.content.slice(0, 400)}`)
        .join("\n\n---\n\n")
    : "  (no code context available)";

  const text = tmpl.template
    .replace(/\{projectName\}/g, input.projectName)
    .replace("{apiCount}", String(input.apis.length))
    .replace("{apiList}", apiList || "  (no APIs extracted)")
    .replace("{context}", contextText);

  return { text, version: tmpl.version };
}

export function buildLineagePrompt(input: LineagePromptInput): { text: string; version: string } {
  const tmpl = getPrompt("lineage_analysis");

  const chunksText = input.chunks
    .slice(0, 8)
    .map((c, i) => `[${i + 1}] File: ${c.file ?? "unknown"} (${c.type ?? "code"})\n${c.content.slice(0, 400)}`)
    .join("\n\n---\n\n");

  const deterministicText =
    input.deterministicTables.length > 0
      ? input.deterministicTables
          .map((t) => `  ${t.name} — ${t.operation} (confidence: ${Math.round(t.confidence * 100)}%)`)
          .join("\n")
      : "  none found";

  const text = tmpl.template
    .replace("{method}", input.method)
    .replace("{path}", input.path)
    .replace("{handler}", input.handler ?? "unknown")
    .replace("{chunks}", chunksText || "  (no relevant code chunks found)")
    .replace("{schema}", input.schemaText || "  (schema not extracted yet)")
    .replace("{deterministic}", deterministicText);

  return { text, version: tmpl.version };
}
