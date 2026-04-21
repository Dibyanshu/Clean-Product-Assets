# ArchonAI — Agentic Legacy Modernization System

A production-grade monorepo that orchestrates multiple AI agents to parse, analyze, and document legacy codebases. Outputs structured API inventories, DB schema maps, PRDs, semantic search, and AI-enhanced API ↔ DB lineage via RAG.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| API framework | Fastify 5 (plugin-based clean architecture) |
| Database | SQLite via sql.js (pure JS, no native deps) |
| Vector store | In-memory TF-IDF (ChromaDB-compatible interface) |
| LLM | OpenAI `gpt-5-mini` via Replit AI Integrations proxy |
| Validation | Zod |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| API client | Orval codegen from OpenAPI 3.1 spec |
| Build | esbuild |
| Logging | Pino (structured JSON) |

---

## Agents

### Agent 1 — Ingestion
Parses a repository, records all files, and indexes each file's content into the vector store using **multi-language AST-based chunking**.

Supported languages:

| Language | Extension(s) | Parser |
|---|---|---|
| JavaScript | `.js` `.mjs` `.cjs` | Babel real AST |
| TypeScript | `.ts` `.tsx` `.mts` | Babel real AST (typescript plugin) |
| Java | `.java` | Pattern-based brace-depth parser |
| C# / .NET | `.cs` | Pattern-based attribute-aware parser |
| SQL | `.sql` | Pattern-based statement-boundary parser |

Each file produces typed chunks (`function`, `class`, `method`, `api_endpoint`, `sql_table`, `sql_function`, `sql_procedure`) stored in the vector store with full metadata (language, file, line numbers, route/method for API endpoints).

### Agent 2 — Analysis
Queries the vector store for authentication and routing context, then extracts all API routes from the project. Semantic context is injected into the analysis before the LLM pass.

### Agent 3 — PRD Generator
Generates a structured Product Requirements Document from the extracted API inventory. Produces executive summary, API inventory, resource domains, HTTP method distribution, technical requirements, and user stories.

### Agent 4 — DB Schema Extractor
Extracts all tables (with typed columns, primary key flags, nullability) and SQL functions from the database layer. After extraction, serialises the schema to natural language text (e.g. `Table users: id TEXT PRIMARY KEY, email TEXT NOT NULL`) and upserts it into the vector store alongside the code chunks.

### Agent 5 — Lineage Mapper (Deterministic)
Traces how each API endpoint flows through service/repository functions into database table operations. Produces a three-level map:

```
API Endpoint → Handler Function → Database Tables + Operations
```

Detection is fully deterministic — no LLM involved:

| Source | Pattern | Confidence |
|---|---|---|
| Raw SQL string in code | `SELECT … FROM table` / `INSERT INTO table` / etc. | 100% |
| `db.query` / `db.run` calls | Inline SQL literals in Node.js db helpers | 90% |
| Prisma ORM | `prisma.user.findMany()` → `users SELECT` | 85% |
| Function call chain | Route calls `User.findAll()` → that function has SQL | 85% |
| Knex query builder | `knex('users')` | 75% |
| HTTP method + path (fallback) | `GET /api/users` → `users SELECT` | 40% |

Results are stored in three tables (`api_function_map`, `function_table_map`, `api_table_map`) and served via `GET /agent/lineage`.

### Agent 5 AI — Lineage Enhancer (RAG + LLM)
Extends the deterministic lineage using **Retrieval-Augmented Generation**. For each API endpoint:

1. **Retrieve** — queries the vector store for the top 8 most relevant code chunks (deduplicated)
2. **Context** — fetches DB schema table names; formats deterministic results as baseline
3. **Prompt** — assembles a versioned structured prompt (`lineage_analysis_v1`) with API info, code context, schema, and existing mappings
4. **Generate** — calls `gpt-5-mini` with up to 3 retries and 30-second timeout; falls back to deterministic on failure
5. **Validate** — strict JSON parsing; rejects malformed output, normalises table names (lowercase) and operations (uppercase)
6. **Merge** — combines deterministic + LLM results by these rules:

| Match type | Result |
|---|---|
| LLM confirms deterministic (same table + same operation) | `source=merged`, `confidence=high` |
| LLM finds a new table | `source=llm`, `confidence=low` |
| Same table, different operation | Both entries marked `confidence=conflict` |
| Deterministic not seen by LLM | Kept as `source=deterministic` |

7. **Cache** — stores result by `projectId::apiId::promptVersion`; cache hit skips the LLM call entirely
8. **Persist** — writes merged entries back to `api_table_map` with `source`, `confidence_level`, and `prompt_version` columns

---

## Vector Store

A self-contained in-memory vector store (`services/chroma.service.ts`) using **TF-IDF cosine similarity**.

The interface mirrors the ChromaDB JS client exactly — `createOrGetCollection`, `upsertDocuments`, `queryDocuments`, `deleteCollection`. Swap the internals for a real ChromaDB HTTP client (`localhost:8000`) without touching any call-sites.

**Data flow:**
```
Ingest  → AST chunks (code)    ─┐
Schema  → serialised schema    ─┼─► collection[projectId] ──► queryDocuments
Lineage AI RAG retrieval       ◄─┘
```

---

## Shared Services

| Service | File | Purpose |
|---|---|---|
| Vector store | `services/chroma.service.ts` | TF-IDF in-memory vector store, ChromaDB-compatible |
| LLM | `services/llm.service.ts` | OpenAI client wrapper; retry ×3, 30s timeout, response size guard, structured logging per attempt |
| Prompt | `services/prompt.service.ts` | Versioned prompt templates; `buildLineagePrompt()` assembles API + chunks + schema + deterministic context |
| Cache | `services/cache.service.ts` | In-memory `Map` keyed by `projectId::apiId::promptVersion`; logs hits/misses; `invalidateProject()` for selective eviction |
| AST chunker | `services/ast/astChunker.service.ts` | Orchestrates multi-language parsing and chunk production |

---

## API Endpoints

### Agent 1 — Ingestion

```bash
curl -X POST http://localhost/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/example/legacy-app"}'

curl http://localhost/api/agent/projects
curl http://localhost/api/agent/projects/<projectId>
```

### Agent 2 — Analysis

```bash
curl -X POST http://localhost/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

curl http://localhost/api/agent/projects/<projectId>/apis
```

### Agent 3 — PRD Generator

```bash
curl -X POST http://localhost/api/agent/generate-prd \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

curl http://localhost/api/agent/projects/<projectId>/documents
```

### Agent 4 — DB Schema Extractor

```bash
curl -X POST http://localhost/api/agent/extract-db-schema \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

curl http://localhost/api/agent/projects/<projectId>/db-schema
```

### Agent 5 — Lineage Mapper (deterministic)

```bash
# Generate deterministic lineage
curl -X POST http://localhost/api/agent/generate-lineage \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# Get stored lineage (includes source/confidence_level after AI enhancement)
curl "http://localhost/api/agent/lineage?projectId=<projectId>"
```

Response:
```json
{
  "projectId": "...",
  "apiCount": 10,
  "mappedCount": 9,
  "partialCount": 1,
  "unknownCount": 0,
  "entries": [
    {
      "api": { "id": "...", "method": "GET", "path": "/api/users", "handler": "UserController.list" },
      "tables": [
        {
          "name": "users",
          "operation": "SELECT",
          "confidence": 0.9,
          "source": "merged",
          "confidence_level": "high",
          "prompt_version": "v1"
        }
      ],
      "flow": ["UserController.list", "User.findAll"],
      "status": "mapped"
    }
  ]
}
```

### Agent 5 AI — Lineage Enhancer (RAG + LLM)

```bash
# Enhance a single API using RAG + LLM
curl -X POST http://localhost/api/agent/lineage-ai \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>", "apiId": "<apiId>"}'

# Enhance all APIs in a project (sequential, 300ms between calls)
curl -X POST http://localhost/api/agent/lineage-ai/bulk \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# Clear LLM response cache and force re-generation on next call
curl -X POST http://localhost/api/agent/lineage-ai/refresh \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'
```

Enhance response:
```json
{
  "api": "GET /api/orders",
  "apiId": "...",
  "method": "GET",
  "path": "/api/orders",
  "tables": [
    { "name": "orders", "operation": "SELECT", "confidence": "high", "source": "merged", "prompt_version": "v1" },
    { "name": "order_items", "operation": "SELECT", "confidence": "low", "source": "llm", "prompt_version": "v1" }
  ],
  "flow": ["OrderController.list", "OrderService.findAll", "db.query"],
  "source": "merged",
  "promptVersion": "v1",
  "cached": false
}
```

Bulk response:
```json
{
  "projectId": "...",
  "processed": 10,
  "enhanced": 8,
  "fallback": 2,
  "results": [...]
}
```

### Vector Search

```bash
curl "http://localhost/api/agent/search?projectId=<projectId>&q=authentication+middleware&n=5"
```

### Job Tracker

```bash
curl http://localhost/api/agent/jobs
curl http://localhost/api/agent/jobs/<jobId>
```

### AST Chunker Test

```bash
curl -X POST http://localhost/api/agent/test-ast-multi \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/UserController.java",
    "code": "@RestController\npublic class UserController {\n  @GetMapping(\"/users\")\n  public List<User> getAll() { return service.findAll(); }\n}"
  }'
```

### Health

```bash
curl http://localhost/api/healthz
```

---

## Full Workflow (curl)

```bash
# Step 1: Ingest — files parsed, AST chunks indexed in vector store
RESULT=$(curl -s -X POST http://localhost/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/example/legacy-ecommerce"}')
PROJECT_ID=$(echo $RESULT | jq -r '.projectId')

# Step 2: Extract DB schema — tables indexed in vector store
curl -s -X POST http://localhost/api/agent/extract-db-schema \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 3: Analyze — queries vector store for context, extracts API routes
curl -s -X POST http://localhost/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 4: Generate PRD
curl -s -X POST http://localhost/api/agent/generate-prd \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 5: Generate deterministic lineage — maps APIs → functions → DB tables
curl -s -X POST http://localhost/api/agent/generate-lineage \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 6: AI-enhance all lineage entries via RAG + LLM
curl -s -X POST http://localhost/api/agent/lineage-ai/bulk \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 7: Semantic search
curl "http://localhost/api/agent/search?projectId=$PROJECT_ID&q=user+authentication+JWT"
```

---

## Folder Structure

```
.
├── artifacts/
│   ├── api-server/src/
│   │   ├── app.ts                         # Fastify factory + plugin registration
│   │   ├── index.ts                        # Server entrypoint
│   │   ├── plugins/
│   │   │   ├── cors.ts                    # @fastify/cors plugin
│   │   │   └── db.ts                      # DB init plugin (runs migrations)
│   │   ├── db/
│   │   │   ├── sqlite.ts                  # sql.js singleton
│   │   │   └── migrate.ts                 # Schema migrations (10 tables)
│   │   ├── services/
│   │   │   ├── chroma.service.ts          # Vector store (TF-IDF, ChromaDB-compatible)
│   │   │   ├── llm.service.ts             # OpenAI client: retry ×3, timeout, JSON parser
│   │   │   ├── prompt.service.ts          # Versioned prompt templates + context builder
│   │   │   ├── cache.service.ts           # In-memory LLM response cache
│   │   │   └── ast/
│   │   │       ├── astChunker.service.ts  # Orchestrator — language detection + dispatch
│   │   │       ├── types.ts               # AstChunk interface
│   │   │       ├── jsChunker.ts           # Babel real AST (JS + TS)
│   │   │       ├── javaChunker.ts         # Pattern-based Java parser
│   │   │       ├── csharpChunker.ts       # Pattern-based C# parser
│   │   │       └── sqlChunker.ts          # Pattern-based SQL parser
│   │   ├── modules/
│   │   │   ├── ingestion/                 # Agent 1: ingest + AST-chunk + vector upsert
│   │   │   ├── analysis/                  # Agent 2: vector query + API extraction
│   │   │   ├── prd/                       # Agent 3: PRD generation
│   │   │   ├── db-schema/                 # Agent 4: schema extraction + vector upsert
│   │   │   ├── lineage/                   # Agent 5: deterministic lineage mapper
│   │   │   ├── lineage-ai/                # Agent 5 AI: RAG + LLM lineage enhancer
│   │   │   ├── search/                    # GET /agent/search handler
│   │   │   └── ast-test/                  # POST /agent/test-ast-multi handler
│   │   ├── routes/
│   │   │   ├── index.ts
│   │   │   ├── health.ts
│   │   │   └── agent.ts                   # All agent routes registered here
│   │   └── utils/
│   │       ├── id.ts
│   │       └── jobTracker.ts              # In-memory job status Map
│   │
│   └── legacy-modernization-ui/src/
│       ├── pages/
│       │   ├── dashboard.tsx              # Mission control overview
│       │   ├── projects-list.tsx          # All projects table
│       │   ├── project-detail.tsx         # 6-tab project view
│       │   └── jobs-list.tsx              # Global operations log
│       └── components/
│           ├── layout.tsx
│           ├── status-badge.tsx
│           ├── lineage-tab.tsx            # AI-enhanced lineage viewer with source + confidence badges
│           ├── db-schema-tab.tsx          # Accordion schema viewer
│           └── semantic-search-panel.tsx  # TF-IDF search UI with suggestion pills
│
└── lib/
    ├── api-spec/openapi.yaml              # OpenAPI 3.1 source of truth (1000+ lines)
    ├── api-client-react/                  # Orval-generated React Query hooks
    ├── api-zod/                           # Orval-generated Zod schemas
    └── integrations-openai-ai-server/     # OpenAI SDK client + batch utilities
```

---

## Database Tables

| Table | Purpose |
|---|---|
| `projects` | Ingested repos with status tracking |
| `files` | File metadata per project |
| `apis` | Extracted API routes per project |
| `documents` | Generated PRD documents |
| `db_tables` | Extracted database tables |
| `db_columns` | Columns per table (type, primary key, nullable) |
| `db_functions` | Extracted SQL functions and stored procedures |
| `api_function_map` | API endpoint → handler function mapping with confidence |
| `function_table_map` | Function → DB table + SQL operation mapping |
| `api_table_map` | Derived API → table mapping; includes `source`, `confidence_level`, `prompt_version` |

### `api_table_map` extended columns

| Column | Type | Values |
|---|---|---|
| `source` | TEXT | `deterministic` / `llm` / `merged` |
| `confidence_level` | TEXT | `high` / `medium` / `low` / `conflict` |
| `prompt_version` | TEXT | Prompt template version used (`v1`); `NULL` for deterministic-only rows |

---

## Dashboard Tabs (per project)

| Tab | Contents |
|---|---|
| **API Routes** | Extracted endpoints with method badges, path, description, handler |
| **DB Schema** | Accordion tables with column types, primary key icons, nullable flags; function list |
| **Generated PRD** | Full PRD with executive summary, API inventory, user stories, technical requirements |
| **Vector Search** | Semantic search across 50+ indexed chunks; results show type, file, score bar |
| **Lineage** | API → function → table trace; operation badges; confidence% dots; source badges (AI / AI+AST); confidence-level badges (HIGH / MEDIUM / LOW / CONFLICT); per-card "Enhance with AI" button; top-bar "Bulk AI Enhance" and "Refresh Cache" buttons |
| **Job History** | All agent runs for this project with status, timing, and messages |

---

## Architecture Principles

- **Controllers** — thin: parse request, call service, send reply
- **Services** — all business logic; call repositories and other services
- **Repositories** — only DB access; services never touch sql.js directly
- **Vector store** — isolated in `services/chroma.service.ts`; all agents call it but none own it
- **LLM service** — isolated in `services/llm.service.ts`; never called directly from controllers or repositories
- **Cache service** — in-memory; keyed by `projectId::apiId::promptVersion`; completely transparent to callers (get/set/invalidate)
- **Prompt service** — versioned templates; prompt version is part of the cache key, ensuring stale cached responses are automatically bypassed on template upgrades
- **AST chunkers** — one file per language; orchestrator never contains parser logic
- **Logging** — Pino structured JSON; `req.log` in handlers, singleton `logger` in services; every LLM attempt, cache hit/miss, and chunk count logged
- **Job tracker** — in-memory `Map<string, Job>` with `pending → running → completed/failed` lifecycle
- **API contract** — OpenAPI 3.1 spec is the single source of truth; client hooks and Zod schemas are generated, never hand-written

---

## LLM Configuration

| Setting | Value |
|---|---|
| Provider | OpenAI via Replit AI Integrations proxy |
| Model | `gpt-5-mini` |
| Max output tokens | 1024 |
| Max retries | 3 (exponential backoff: 1s / 2s / 3s) |
| Timeout | 30 seconds per attempt |
| Response size guard | 4096 chars max |
| Prompt version | `v1` (`lineage_analysis_v1` template) |
| Fallback | Deterministic lineage returned unchanged if all LLM attempts fail |

---

## Running Locally

```bash
# Install all dependencies
pnpm install

# Run the API server (builds then starts)
pnpm --filter @workspace/api-server run dev

# Run the React dashboard
pnpm --filter @workspace/legacy-modernization-ui run dev

# Regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Full typecheck
pnpm run typecheck
```
