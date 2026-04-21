# Agentic Legacy Modernization System

## Overview

A production-grade backend + React dashboard for orchestrating AI agents to analyze legacy codebases and generate structured outputs (APIs, PRD, HLD, user stories).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Fastify 5 (clean architecture, plugin-based)
- **SQLite**: sql.js (pure JS, in-memory)
- **Validation**: Zod
- **Frontend**: React + Vite + Tailwind CSS + Shadcn UI
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

- **Controller → Service → Repository** pattern
- Four AI agents: Ingestion, Analysis, PRD Generator, DB Schema Extractor
- In-memory job status tracker
- Mock LLM service for PRD generation
- Mock schema extraction (tables, columns, functions)

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

## Folder Structure

```
artifacts/api-server/src/
├── app.ts                     # Fastify app factory + plugin registration
├── index.ts                   # Server entrypoint (fastify.listen)
├── plugins/
│   ├── cors.ts                # @fastify/cors plugin
│   └── db.ts                  # DB init (runs migrations) plugin
├── db/sqlite.ts               # SQLite (sql.js) singleton
├── db/migrate.ts              # Schema migrations
├── modules/
│   ├── ingestion/             # Agent 1
│   ├── analysis/              # Agent 2
│   └── prd/                   # Agent 3 + Mock LLM
├── routes/
│   ├── index.ts               # Root route plugin (registers health + agent)
│   ├── health.ts              # GET /healthz
│   └── agent.ts               # All agent routes
└── utils/jobTracker.ts        # In-memory job tracker

artifacts/legacy-modernization-ui/
└── src/
    ├── pages/
    │   ├── dashboard.tsx       # Mission control pipeline UI
    │   ├── projects-list.tsx   # All projects table
    │   ├── project-detail.tsx  # APIs, PRD, job history
    │   └── jobs-list.tsx       # Global operations log
    └── components/
        ├── layout.tsx
        └── status-badge.tsx
```
