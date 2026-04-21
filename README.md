# ArchonAI — Agentic Legacy Modernization System

A production-grade monorepo that orchestrates multiple AI agents to parse, analyze, and document legacy codebases. Outputs structured API inventories, DB schema maps, PRDs, and semantic search across all indexed code.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces |
| Runtime | Node.js 24 |
| Language | TypeScript 5.9 |
| API framework | Fastify 5 (plugin-based clean architecture) |
| Database | SQLite via sql.js (pure JS, no native deps) |
| Validation | Zod |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| API client | Orval codegen from OpenAPI 3.1 spec |
| Build | esbuild |
| Logging | Pino (structured JSON) |

---

## Agents

### Agent 5 — Lineage Mapper
Traces how each API endpoint flows through service/repository functions into database table operations. Produces a three-level map:

```
API Endpoint → Handler Function → Database Tables + Operations
```

Detection is fully deterministic — no LLM involved:

| Source | Pattern | Confidence |
|---|---|---|
| Raw SQL string in code | `SELECT … FROM table` / `INSERT INTO table` / etc. | 100% |
| db.query / db.run calls | Inline SQL literals in Node.js db helpers | 90% |
| Prisma ORM | `prisma.user.findMany()` → `users SELECT` | 85% |
| Function call chain | Route calls `User.findAll()` → that function has SQL | 85% |
| Knex query builder | `knex('users')` | 75% |
| HTTP method + path (fallback) | `GET /api/users` → `users SELECT` | 40% |

Results are stored in three tables (`api_function_map`, `function_table_map`, `api_table_map`) and served via `GET /agent/lineage`.

---

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

Each file produces typed chunks (function, class, method, api_endpoint, sql_table, sql_function, sql_procedure) stored in the vector store with full metadata (language, file, line numbers, route/method for API endpoints).

### Agent 2 — Analysis
Queries the vector store for authentication and routing context, then extracts all API routes from the project. Semantic context is injected into the analysis before the LLM pass.

### Agent 3 — PRD Generator
Generates a structured Product Requirements Document from the extracted API inventory. Uses a mock LLM service that produces executive summary, API inventory, resource domains, HTTP method distribution, technical requirements, and user stories.

### Agent 4 — DB Schema Extractor
Extracts all tables (with typed columns, primary key flags, nullability) and SQL functions from the database layer. After extraction, serialises the schema to natural language text (e.g. `Table users: id TEXT PRIMARY KEY, email TEXT NOT NULL`) and upserts it into the vector store alongside the code chunks.

---

## Vector Store

A self-contained in-memory vector store (`services/chroma.service.ts`) using **TF-IDF cosine similarity**.

The interface mirrors the ChromaDB JS client exactly — `createOrGetCollection`, `upsertDocuments`, `queryDocuments`, `deleteCollection`. Swap the internals for a real ChromaDB HTTP client (`localhost:8000`) without touching any call-sites.

**Data flow:**
```
Ingest  → AST chunks (code)    ─┐
Schema  → serialised schema    ─┼─► collection[projectId] ──► queryDocuments
Analysis reads context         ◄─┘
```

---

## API Endpoints

### Agent 1 — Ingestion

```bash
# Ingest a repository
curl -X POST http://localhost/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/example/legacy-app"}'

# List all projects
curl http://localhost/api/agent/projects

# Get project by ID
curl http://localhost/api/agent/projects/<projectId>
```

### Agent 2 — Analysis

```bash
# Analyze a project (extract API routes + query vector store for context)
curl -X POST http://localhost/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# List extracted API routes
curl http://localhost/api/agent/projects/<projectId>/apis
```

### Agent 3 — PRD Generator

```bash
# Generate PRD document
curl -X POST http://localhost/api/agent/generate-prd \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# List generated documents
curl http://localhost/api/agent/projects/<projectId>/documents
```

### Agent 4 — DB Schema Extractor

```bash
# Extract and index DB schema
curl -X POST http://localhost/api/agent/extract-db-schema \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# Get extracted schema (tables + columns + functions)
curl http://localhost/api/agent/projects/<projectId>/db-schema
```

### Vector Search

```bash
# Semantic search across all indexed code and schema
curl "http://localhost/api/agent/search?projectId=<projectId>&q=authentication+middleware&n=5"
```

Response:
```json
{
  "projectId": "...",
  "query": "authentication middleware",
  "indexedDocuments": 51,
  "results": [
    {
      "id": "src/middleware/auth.js::js::fn::authenticate::0",
      "content": "function authenticate(req, res, next) { ... }",
      "metadata": { "type": "function", "name": "authenticate", "file": "src/middleware/auth.js", "language": "javascript" },
      "score": 0.376
    }
  ]
}
```

### Agent 5 — Lineage Mapper

```bash
# Generate lineage (run after ingest + analyze)
curl -X POST http://localhost/api/agent/generate-lineage \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# Get stored lineage
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
      "api": { "method": "GET", "path": "/api/users", "handler": "UserController.list" },
      "tables": [{ "name": "users", "operation": "SELECT", "confidence": 1.0 }],
      "flow": ["UserController.list"],
      "status": "mapped"
    }
  ]
}
```

### AST Chunker Test

```bash
# Test multi-language AST chunking on any code snippet
curl -X POST http://localhost/api/agent/test-ast-multi \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "src/UserController.java",
    "code": "@RestController\npublic class UserController {\n  @GetMapping(\"/users\")\n  public List<User> getAll() { return service.findAll(); }\n}"
  }'
```

### Job Tracker

```bash
# List all agent jobs
curl http://localhost/api/agent/jobs

# Get specific job
curl http://localhost/api/agent/jobs/<jobId>
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

# Step 5: Generate lineage — maps APIs → functions → DB tables
curl -s -X POST http://localhost/api/agent/generate-lineage \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 6: Semantic search
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
│   │   │   └── migrate.ts                 # Schema migrations
│   │   ├── services/
│   │   │   ├── chroma.service.ts          # Vector store (TF-IDF, ChromaDB-compatible)
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
│   │   │   ├── prd/                       # Agent 3: PRD generation + mock LLM
│   │   │   ├── db-schema/                 # Agent 4: schema extraction + vector upsert
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
│       │   ├── project-detail.tsx         # 5-tab project view
│       │   └── jobs-list.tsx              # Global operations log
│       └── components/
│           ├── layout.tsx
│           ├── status-badge.tsx
│           ├── db-schema-tab.tsx          # Accordion schema viewer
│           └── semantic-search-panel.tsx  # TF-IDF search UI with suggestion pills
│
├── lib/
│   ├── api-spec/openapi.yaml              # OpenAPI 3.1 source of truth
│   ├── api-client-react/                  # Orval-generated React Query hooks
│   └── api-zod/                           # Orval-generated Zod schemas
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
| `api_table_map` | Derived API → table mapping (pre-joined for fast reads) |

---

## Dashboard Tabs (per project)

| Tab | Contents |
|---|---|
| **API Routes** | Extracted endpoints with method badges, path, description, handler |
| **DB Schema** | Accordion tables with column types, primary key icons, nullable flags; function list |
| **Generated PRD** | Full PRD with executive summary, API inventory, user stories, technical requirements |
| **Vector Search** | Semantic search across 50+ indexed chunks; results show type, file, score bar |
| **Lineage** | API → function → table trace with operation badges and confidence scores; "Re-run" button |
| **Job History** | All agent runs for this project with status, timing, and messages |

---

## Architecture Principles

- **Controllers** — thin: parse request, call service, send reply
- **Services** — all business logic; call repositories and other services
- **Repositories** — only DB access; services never touch sql.js directly
- **Vector store** — isolated in `services/chroma.service.ts`; all agents call it but none own it
- **AST chunkers** — one file per language; orchestrator never contains parser logic
- **Logging** — Pino structured JSON; `req.log` in handlers, singleton `logger` in services
- **Job tracker** — in-memory `Map<string, Job>` with `pending → running → completed/failed` lifecycle
- **API contract** — OpenAPI 3.1 spec is the single source of truth; client hooks and Zod schemas are generated, never hand-written

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
