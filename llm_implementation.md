# LLM Implementation

This project uses the OpenAI SDK through the internal package `@workspace/integrations-openai-ai-server`. The API server calls the LLM from a small shared service layer, then validates and post-processes every model response before storing results.

## Environment Variables

The server-side OpenAI client reads these variables:

```env
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
```

`OPENAI_API_KEY` is required only when an LLM feature is actually called. The client is initialized lazily, so the API server can still start and non-LLM endpoints can work without an API key.

`OPENAI_BASE_URL` is optional. Leave it unset for the default OpenAI API, or set it when using an OpenAI-compatible gateway/proxy.

## Main Files

| File | Purpose |
|---|---|
| `lib/integrations-openai-ai-server/src/client.ts` | Creates the OpenAI SDK client lazily using `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`. |
| `artifacts/api-server/src/services/llm.service.ts` | Shared LLM call wrapper: model, retries, timeout, response limits, JSON parsers. |
| `artifacts/api-server/src/services/prompt.service.ts` | Versioned prompt templates and prompt builders. |
| `artifacts/api-server/src/services/cache.service.ts` | In-memory cache used by AI lineage enhancement. |
| `artifacts/api-server/src/modules/prd/service/prd.service.ts` | Uses LLM to generate PRDs, with deterministic fallback. |
| `artifacts/api-server/src/modules/lineage-ai/service/lineageAI.service.ts` | Uses RAG + LLM to enhance deterministic API-to-table lineage. |
| `artifacts/api-server/src/modules/hld/service/hld.service.ts` | Uses RAG + LLM to generate HLD documents, with deterministic fallback. |
| `artifacts/api-server/src/services/chroma.service.ts` | In-memory TF-IDF retrieval used as the RAG source. |

## OpenAI Client

The exported `openai` object is a lazy proxy. It does not construct the real SDK client until a property is accessed, such as:

```ts
openai.chat.completions.create(...)
```

This prevents app startup from failing when `OPENAI_API_KEY` is missing. If an LLM endpoint is called without the key, the error is raised at call time.

## Shared LLM Call Wrapper

All text-generation features go through:

```ts
generate(prompt, ctx)
```

Defined in:

```text
artifacts/api-server/src/services/llm.service.ts
```

Current behavior:

| Setting | Value |
|---|---|
| Model | `gpt-5-mini` |
| Retry count | `3` attempts |
| Timeout | `30_000 ms` per request |
| Default max completion tokens | `1024` |
| Max response size | `4096` characters |
| System instruction | Respond with valid JSON only; no markdown or prose. |

The service logs each attempt, retries with incremental backoff, rejects empty responses, rejects oversized responses, and returns the raw model text only after basic transport-level validation.

## Prompt Templates

Prompt templates live in:

```text
artifacts/api-server/src/services/prompt.service.ts
```

The project currently defines these prompt versions:

| Prompt | Version | Used By |
|---|---|---|
| `prd_generation` | `v1` | PRD generation |
| `lineage_analysis` | `v1` | AI lineage enhancement |
| `hld_analysis` | `v1` | HLD generation |

Prompt version is important because lineage AI cache keys include the prompt version:

```text
projectId::apiId::promptVersion
```

Changing a prompt version invalidates old lineage cache entries naturally.

## PRD Generation Flow

Endpoint:

```http
POST /api/agent/generate-prd
```

Implementation:

```text
artifacts/api-server/src/modules/prd/service/prd.service.ts
```

Flow:

1. Load the project.
2. Load extracted APIs. If no APIs exist, fail with "Run analysis first."
3. Retrieve semantic context from the vector store using a business/auth query.
4. Deduplicate retrieved chunks.
5. Build `prd_generation_v1` prompt.
6. Call `generate()` with `maxTokens: 1500`.
7. Parse with `parsePrdOutput()`.
8. Store the generated PRD in the `documents` table and create an approval record.

Fallback:

If the LLM call or parsing fails, the service uses a deterministic PRD template from:

```text
artifacts/api-server/src/modules/prd/services/llm.service.ts
```

Expected JSON shape:

```json
{
  "title": "Product Requirements Document - Project Name",
  "overview": "Short overview",
  "sections": [
    {
      "title": "Executive Summary",
      "content": "..."
    }
  ]
}
```

## AI Lineage Enhancement Flow

Endpoints:

```http
POST /api/agent/lineage-ai
POST /api/agent/lineage-ai/bulk
POST /api/agent/lineage-ai/refresh
```

Implementation:

```text
artifacts/api-server/src/modules/lineage-ai/service/lineageAI.service.ts
```

The AI lineage feature enhances deterministic API-to-database mappings. It does not replace deterministic lineage; it merges model output with deterministic results.

Flow for a single API:

1. Load the API record by `projectId` and `apiId`.
2. Load existing deterministic table mappings.
3. Query the vector store using API path, handler, method, and database-related terms.
4. Retrieve up to 10 chunks, deduplicate them, then keep the top 8.
5. Load schema context from extracted database tables.
6. Build `lineage_analysis_v1` prompt.
7. Check in-memory cache by `projectId::apiId::promptVersion`.
8. If no cache hit, call `generate()`.
9. Parse with `parseLineageOutput()`.
10. Merge LLM output with deterministic mappings.
11. Persist merged mappings back to `api_table_map`.
12. Store result in cache.

Merge rules:

| Case | Result |
|---|---|
| LLM confirms same table and operation as deterministic | `source = merged`, `confidence = high` |
| LLM finds a new table/operation | `source = llm`, `confidence = low` |
| LLM finds same table but different operation | both entries marked `confidence = conflict` |
| LLM fails or returns invalid JSON | deterministic results are kept |

Bulk behavior:

`lineage-ai/bulk` processes APIs sequentially and waits `300 ms` between calls.

Expected JSON shape:

```json
{
  "tables": [
    {
      "name": "orders",
      "operation": "SELECT"
    }
  ],
  "flow": ["OrderController.list", "OrderService.findAll", "db.query"]
}
```

Validation rules:

- Table names are lowercased.
- Operations are uppercased.
- Allowed operations are `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `QUERY`.
- Invalid table names are discarded.
- Invalid or malformed JSON causes fallback to deterministic lineage.

## HLD Generation Flow

Endpoints:

```http
POST /api/agent/generate-hld
POST /api/agent/hld/refresh
GET /api/agent/hld
```

Implementation:

```text
artifacts/api-server/src/modules/hld/service/hld.service.ts
```

Flow:

1. Load extracted APIs. If none exist, fail with "Run analyze first."
2. Load API-to-table lineage.
3. Load extracted schema tables.
4. Build lineage text, limited to 30 APIs.
5. Build schema text, limited to 25 tables.
6. Retrieve code context from the vector store using multiple semantic queries:
   - authentication logic
   - order processing
   - user management
   - data access
   - business logic
7. Deduplicate retrieved chunks and keep up to 10 snippets.
8. Build `hld_analysis_v1` prompt.
9. Call `generate()` with `maxTokens: 2048`.
10. Parse with `parseHldOutput()`.
11. Post-process modules:
    - Deduplicate API assignments.
    - Add missing APIs to "Other Endpoints".
    - Normalize table names.
12. Delete the previous HLD document for the project.
13. Store the new HLD document in `documents` with type `hld`.

Fallback:

If the LLM fails or returns invalid output, the service generates a deterministic HLD by grouping APIs by path segment and mapping tables from lineage. The stored prompt version becomes:

```text
deterministic-v1
```

Expected JSON shape:

```json
{
  "overview": "System overview",
  "modules": [
    {
      "name": "Order Service",
      "apis": ["GET /api/orders"],
      "tables": ["orders"]
    }
  ],
  "dataFlow": ["User Management -> Order Service (userId on order creation)"],
  "architecture": "Modular Monolith"
}
```

## Retrieval-Augmented Generation

RAG is implemented with the local vector service:

```text
artifacts/api-server/src/services/chroma.service.ts
```

Despite the Chroma-compatible naming, the current implementation is an in-memory TF-IDF cosine similarity store. It is populated during ingestion and schema extraction.

Used by:

- PRD generation for business/auth context.
- AI lineage enhancement for endpoint-specific code chunks.
- HLD generation for architecture/business logic context.

This means LLM features work best after running:

1. Ingestion
2. DB schema extraction
3. API analysis
4. Deterministic lineage

## Error Handling and Fallbacks

The system is designed so LLM failures do not block the core deterministic pipeline.

| Feature | On LLM Failure |
|---|---|
| PRD | Uses deterministic PRD template. |
| AI Lineage | Keeps deterministic lineage mappings. |
| HLD | Uses deterministic HLD generator. |

Common failure reasons:

- Missing `OPENAI_API_KEY`
- Timeout after 30 seconds
- Empty response
- Response larger than 4096 characters
- Invalid JSON
- JSON with missing required fields

## Logging

LLM calls log structured events with:

- `promptName`
- `promptVersion`
- `projectId`
- `apiId`, for lineage calls
- attempt number
- response length
- error message on failure

Logs are emitted through:

```text
artifacts/api-server/src/lib/logger.ts
```

## Local Testing

Start the API server:

```powershell
pnpm.cmd --filter @workspace/api-server run dev
```

Optional OpenAI setup:

```powershell
$env:OPENAI_API_KEY="your_api_key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
```

Health check:

```powershell
Invoke-RestMethod http://localhost:8080/api/healthz
```

Recommended LLM workflow:

```bash
curl -X POST http://localhost:8080/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/example/legacy-app"}'

curl -X POST http://localhost:8080/api/agent/extract-db-schema \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<projectId>"}'

curl -X POST http://localhost:8080/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<projectId>"}'

curl -X POST http://localhost:8080/api/agent/generate-lineage \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<projectId>"}'

curl -X POST http://localhost:8080/api/agent/lineage-ai/bulk \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<projectId>"}'

curl -X POST http://localhost:8080/api/agent/generate-hld \
  -H "Content-Type: application/json" \
  -d '{"projectId":"<projectId>"}'
```

## Notes for Future Changes

- If a prompt changes materially, create a new prompt version instead of editing the old one in place.
- Keep model output JSON-only and validate every response before persisting.
- Keep deterministic fallbacks available so analysis remains usable without an API key.
- If `OPENAI_BASE_URL` points to a compatible provider, verify that it supports the same model and response fields used by `chat.completions.create`.
