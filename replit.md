# Agentic Legacy Modernization System

## Overview

A production-grade backend + React dashboard for orchestrating AI agents to analyze legacy codebases and generate structured outputs (APIs, PRD, DB schema, lineage). Includes AI-enhanced API ↔ DB lineage via RAG (Retrieval-Augmented Generation) using OpenAI.

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
- **Five agents + one AI enhancement layer**: Ingestion, Analysis, PRD Generator, DB Schema Extractor, Lineage Mapper (deterministic), Lineage Enhancer (RAG + LLM)
- In-memory vector store (TF-IDF cosine similarity, ChromaDB-compatible interface)
- Pluggable multi-language AST chunker: JS/TS (Babel real AST), Java, C#, SQL (pattern-based)
- Shared services layer: `llm.service.ts` (retry + timeout + JSON validation), `prompt.service.ts` (versioned templates), `cache.service.ts` (projectId+apiId+promptVersion key)
- Semantic search endpoint: `GET /api/agent/search?projectId=&q=`
- AST test endpoint: `POST /api/agent/test-ast-multi`
- In-memory job status tracker

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/api-server run dev` — run API server locally

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
│   ├── llm.service.ts         # OpenAI wrapper: retry, timeout, JSON validation
│   ├── prompt.service.ts      # Versioned prompt templates
│   ├── cache.service.ts       # In-memory LLM response cache
│   └── ast/                   # Multi-language AST chunkers
├── modules/
│   ├── ingestion/             # Agent 1
│   ├── analysis/              # Agent 2
│   ├── prd/                   # Agent 3
│   ├── db-schema/             # Agent 4
│   ├── lineage/               # Agent 5: deterministic
│   ├── lineage-ai/            # Agent 5 AI: RAG + LLM
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
│   ├── project-detail.tsx
│   └── jobs-list.tsx
└── components/
    ├── layout.tsx
    ├── status-badge.tsx
    ├── lineage-tab.tsx         # AI-enhanced lineage UI with source + confidence badges
    ├── db-schema-tab.tsx
    └── semantic-search-panel.tsx

lib/
├── api-spec/openapi.yaml
├── api-client-react/           # Orval-generated hooks (incl. useEnhanceLineageAI, useBulkEnhance, useRefreshCache)
├── api-zod/
└── integrations-openai-ai-server/   # OpenAI SDK client + batch utilities
```

## Database Schema — api_table_map (extended)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `project_id` | TEXT | FK → projects |
| `api_id` | TEXT | FK → apis |
| `table_name` | TEXT | Lowercase table name |
| `operation` | TEXT | SELECT / INSERT / UPDATE / DELETE / QUERY |
| `confidence` | REAL | Float 0–1 (deterministic confidence score) |
| `source` | TEXT | `deterministic` / `llm` / `merged` |
| `confidence_level` | TEXT | `high` / `medium` / `low` / `conflict` |
| `prompt_version` | TEXT | e.g. `v1`; NULL for deterministic-only rows |
