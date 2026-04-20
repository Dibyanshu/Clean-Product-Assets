# Agentic Legacy Modernization System

A production-grade Node.js backend that orchestrates multiple AI agents to analyze legacy codebases and generate structured outputs (APIs, PRD, HLD, user stories).

## Tech Stack

- **Runtime**: Node.js (LTS)
- **Framework**: Express 5 (Fastify-style clean architecture)
- **Language**: TypeScript
- **Database**: SQLite (via sql.js — pure JS, no native deps)
- **Validation**: Zod
- **Architecture**: Controller → Service → Repository (clean architecture)
- **Build**: esbuild

## Folder Structure

```
artifacts/api-server/src/
├── app.ts                          # Express app setup + DB init
├── index.ts                        # Server entrypoint
├── db/
│   ├── sqlite.ts                   # SQLite (sql.js) singleton
│   └── migrate.ts                  # Schema migrations
├── lib/
│   └── logger.ts                   # Pino logger
├── modules/
│   ├── ingestion/
│   │   ├── controller/             # Thin HTTP controllers
│   │   ├── service/                # Business logic
│   │   └── repository/             # DB access
│   ├── analysis/
│   │   ├── controller/
│   │   ├── service/
│   │   └── repository/
│   └── prd/
│       ├── controller/
│       ├── service/                # includes mock LLM service
│       ├── services/llm.service.ts # Mock LLM PRD generator
│       └── repository/
├── routes/
│   ├── health.ts
│   ├── agent.ts                    # All agent routes
│   └── index.ts
└── utils/
    ├── id.ts                       # UUID generation
    └── jobTracker.ts               # In-memory job status tracker
```

## Database Tables

| Table       | Purpose                                  |
|-------------|------------------------------------------|
| projects    | Ingested repos with status tracking       |
| files       | File metadata per project                 |
| apis        | Extracted API routes per project          |
| documents   | Generated PRD / HLD documents             |
| approvals   | Document approval workflow records        |

## API Endpoints

### Agent 1 — Ingestion

```bash
# Ingest a repository
curl -X POST http://localhost/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/example/legacy-app.git"}'

# List all projects
curl http://localhost/api/agent/projects

# Get project by ID
curl http://localhost/api/agent/projects/<projectId>
```

### Agent 2 — Analysis

```bash
# Analyze a project (extract API routes)
curl -X POST http://localhost/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# List extracted APIs for a project
curl http://localhost/api/agent/projects/<projectId>/apis
```

### Agent 3 — PRD Generator

```bash
# Generate PRD document
curl -X POST http://localhost/api/agent/generate-prd \
  -H "Content-Type: application/json" \
  -d '{"projectId": "<projectId>"}'

# List documents for a project
curl http://localhost/api/agent/projects/<projectId>/documents
```

### Job Status Tracker

```bash
# List all jobs
curl http://localhost/api/agent/jobs

# Get specific job
curl http://localhost/api/agent/jobs/<jobId>
```

### Health Check

```bash
curl http://localhost/api/healthz
```

## Sample curl Workflow

```bash
# Step 1: Ingest
RESULT=$(curl -s -X POST http://localhost/api/agent/ingest \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/example/legacy-ecommerce.git"}')

PROJECT_ID=$(echo $RESULT | jq -r '.projectId')

# Step 2: Analyze
curl -s -X POST http://localhost/api/agent/analyze \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Step 3: Generate PRD
curl -s -X POST http://localhost/api/agent/generate-prd \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\"}"

# Check jobs
curl http://localhost/api/agent/jobs
```

## Architecture Principles

- **Controllers**: Thin — only parse request, call service, send response
- **Services**: All business logic lives here
- **Repositories**: All database access is abstracted — services never touch the DB directly
- **Validation**: Zod schemas at the controller boundary
- **Logging**: Pino structured logging — `req.log` in handlers, singleton `logger` elsewhere
- **Job Tracker**: In-memory `Map<string, Job>` tracks status for all agent executions

## Running Locally

```bash
# Install dependencies
pnpm install

# Build and run the API server
pnpm --filter @workspace/api-server run dev
```

## Bonus Features

- In-memory job status tracker with `pending → running → completed/failed` lifecycle
- Per-agent structured request logging with `req.log.info({ jobId, ... })`
- Mock LLM service that generates structured PRDs from analyzed API data
- Clean modular structure — no file exceeds 150 lines
