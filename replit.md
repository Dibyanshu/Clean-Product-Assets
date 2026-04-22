# Agentic Legacy Modernization System

## Overview

A production-grade backend + React dashboard for orchestrating AI agents to analyze legacy codebases and generate structured outputs (APIs, PRD, DB schema, lineage, High-Level Design). Includes AI-enhanced API ↔ DB lineage via RAG and auto-generated HLD documents using OpenAI.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Fastify 5 (clean architecture, plugin-based)
- **SQLite**: sql.js (pure JS, in-memory)
- **Validation**: Zod
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **API codegen**: Orval (from OpenAPI 3.1 spec)
- **Build**: esbuild
- **LLM**: OpenAI `gpt-5-mini` via Replit AI Integrations proxy (env vars: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **Vector store**: In-memory TF-IDF cosine similarity (ChromaDB-compatible interface)

## Architecture

- **Controller → Service → Repository** pattern
- **Seven agent roles**: Ingestion, Analysis, PRD Generator, DB Schema Extractor, Lineage Mapper (deterministic), Lineage Enhancer (RAG + LLM), HLD Generator (RAG + LLM)
- **DB Browser**: Admin UI at `/db-browser` — live-queries all SQLite tables with paginated row viewer; powered by `GET /api/admin/db/tables` + `GET /api/admin/db/tables/:table/rows`
- In-memory vector store (TF-IDF cosine similarity, ChromaDB-compatible interface)
- Pluggable multi-language AST chunker: JS/TS (Babel real AST), Java, C#, SQL (pattern-based)
- Shared services: `llm.service.ts` (retry + configurable maxTokens + two output parsers), `prompt.service.ts` (two versioned templates), `cache.service.ts` (lineage cache)
- Semantic search endpoint: `GET /api/agent/search?projectId=&q=`
- AST test endpoint: `POST /api/agent/test-ast-multi`
- In-memory job status tracker

## Key Commands

### Workspace-wide
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm install` — install all dependencies (required for pnpm monorepo)

### API Server
- `pnpm --filter @workspace/api-server run dev` — run API server on port 3000
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec

### Frontend (React + Vite)
- `PORT=21168 BASE_PATH=/ pnpm --filter @workspace/legacy-modernization-ui run dev` — run frontend dev server on port 21168
  - **Alternative**: `pnpm -F @workspace/legacy-modernization-ui run dev` (with env vars pre-set)

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/healthz | Health check |
| POST | /api/agent/ingest | Agent 1: Ingest repository |
| GET | /api/agent/projects | List all projects |
| GET | /api/agent/projects/:id | Get project |
| POST | /api/agent/analyze | Agent 2: Analyze project |
| GET | /api/agent/projects/:id/apis | List extracted APIs |
| POST | /api/agent/generate-prd | Agent 3: Generate PRD |
| GET | /api/agent/projects/:id/documents | List documents |
| POST | /api/agent/extract-db-schema | Agent 4: Extract DB schema |
| GET | /api/agent/projects/:id/db-schema | Get extracted DB schema |
| GET | /api/agent/jobs | List all jobs |
| GET | /api/agent/jobs/:id | Get job by ID |
| POST | /api/agent/generate-lineage | Agent 5: Deterministic API ↔ DB lineage |
| GET | /api/agent/lineage | Get stored lineage (includes AI fields post-enhancement) |
| POST | /api/agent/lineage-ai | Agent 5 AI: RAG+LLM enhance single API lineage |
| POST | /api/agent/lineage-ai/bulk | Agent 5 AI: Enhance all APIs in a project |
| POST | /api/agent/lineage-ai/refresh | Clear LLM cache for a project |
| POST | /api/agent/generate-hld | Agent 6: Generate HLD from lineage + Chroma + LLM |
| GET | /api/agent/hld | Get the latest stored HLD for a project |
| POST | /api/agent/hld/refresh | Delete existing HLD and regenerate |
| GET | /api/agent/search | Semantic vector search |
| POST | /api/agent/test-ast-multi | Test multi-language AST chunker |

## Lineage AI — RAG Flow

For each API endpoint the enhancer runs:
1. Cache lookup by `projectId::apiId::promptVersion` — return immediately on hit
2. Chroma `queryDocuments` top-10 chunks → deduplicate → trim to 8
3. Fetch DB table names from `db_tables`
4. Build `lineage_analysis_v1` prompt (API info + chunks + schema + deterministic baseline)
5. Call `gpt-5-mini` with retry ×3 (backoff 1/2/3s), 30s timeout — fallback to deterministic on failure
6. Validate JSON: lowercase table names, uppercase operations, discard invalid entries
7. Merge: `merged=high` (LLM confirms), `llm=low` (LLM-only), `conflict` (same table, different op)
8. Write to `api_table_map` with `source`, `confidence_level`, `prompt_version`
9. Store in cache

## HLD Generator — RAG Flow

Runs once per project, synthesises all prior analysis into a High-Level Design:
1. Guard: requires ≥1 extracted API
2. Aggregate lineage: join `api_table_map` + `apis` → `METHOD /path → table (OP)` lines (up to 30)
3. Fetch schema: up to 25 table names from `db_tables`
4. Retrieve Chroma context: 5 semantic queries, deduplicated, cap 10 chunks × 350 chars
5. Build `hld_analysis_v1` prompt with lineage + schema + context
6. Call `gpt-5-mini` with `maxTokens=2048`, retry ×3, 30s timeout
7. Validate: must return object with non-empty `modules` array; normalise table names to lowercase
8. Post-process: deduplicate API assignments, assign unmatched APIs to "Other Endpoints", validate data flow
9. Delete prior HLD for this project; store in `documents` with `type="hld"`

## Prompt Templates

| Template | Used by | maxTokens | Purpose |
|---|---|---|---|
| `lineage_analysis_v1` | Lineage Enhancer | 1024 | Per-API table + operation mapping |
| `hld_analysis_v1` | HLD Generator | 2048 | Full system module clustering + data flow |

## Folder Structure

```
artifacts/api-server/src/
├── app.ts
├── index.ts
├── plugins/
│   ├── cors.ts
│   └── db.ts
├── db/
│   ├── sqlite.ts
│   └── migrate.ts
├── services/
│   ├── chroma.service.ts      # Vector store
│   ├── llm.service.ts         # OpenAI wrapper: retry, configurable maxTokens, parseLineageOutput + parseHldOutput
│   ├── prompt.service.ts      # lineage_analysis_v1 + hld_analysis_v1 templates
│   ├── cache.service.ts       # In-memory LLM response cache
│   └── ast/                   # Multi-language AST chunkers
├── modules/
│   ├── ingestion/             # Agent 1
│   ├── analysis/              # Agent 2
│   ├── prd/                   # Agent 3 + shared document repository
│   ├── db-schema/             # Agent 4
│   ├── lineage/               # Agent 5: deterministic
│   ├── lineage-ai/            # Agent 5 AI: RAG + LLM per-API enhancer
│   ├── hld/                   # Agent 6: HLD generator (RAG + LLM, project-level)
│   ├── search/
│   └── ast-test/
├── routes/
│   ├── index.ts
│   ├── health.ts
│   └── agent.ts
└── utils/
    ├── id.ts
    └── jobTracker.ts

artifacts/legacy-modernization-ui/src/
├── pages/
│   ├── dashboard.tsx
│   ├── projects-list.tsx
│   ├── project-detail.tsx      # 7-tab view (APIs, DB Schema, PRD, Vector Search, Lineage, HLD, Jobs)
│   └── jobs-list.tsx
└── components/
    ├── layout.tsx
    ├── status-badge.tsx
    ├── lineage-tab.tsx          # AI-enhanced lineage UI with source + confidence badges
    ├── hld-tab.tsx              # HLD viewer: module cards, data flow, export JSON
    ├── db-schema-tab.tsx
    └── semantic-search-panel.tsx

lib/
├── api-spec/openapi.yaml
├── api-client-react/            # Orval-generated hooks (incl. useGenerateHld, useGetHld, useRefreshHld)
├── api-zod/
└── integrations-openai-ai-server/
```

## Database Schema Notes

### `documents` table — type discriminator

| `type` value | Generator | Stored by |
|---|---|---|
| `"prd"` | Agent 3 PRD Generator | `prd.repository.insertDocument` |
| `"hld"` | Agent 6 HLD Generator | `prd.repository.insertDocument` + `deleteDocumentsByProjectAndType` |

### `api_table_map` extended columns

| Column | Type | Values |
|---|---|---|
| `source` | TEXT | `deterministic` / `llm` / `merged` |
| `confidence_level` | TEXT | `high` / `medium` / `low` / `conflict` |
| `prompt_version` | TEXT | e.g. `v1`; NULL for deterministic-only rows |
