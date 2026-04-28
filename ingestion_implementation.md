# Ingestion Implementation

## Overview

The ingestion flow turns a Git repository URL into three things the rest of the
system can use:

- A persisted project row in SQLite.
- File metadata rows for the source files that were discovered.
- Searchable code chunks in the project-scoped, in-memory Chroma-compatible
  vector store.

The main implementation lives in
`artifacts/api-server/src/modules/ingestion/service/ingestion.service.ts`.

## Entrypoint Flow

The HTTP route is registered in `artifacts/api-server/src/routes/agent.ts`:

```ts
fastify.post("/agent/ingest", ingestHandler);
```

`ingestHandler` lives in
`artifacts/api-server/src/modules/ingestion/controller/ingestion.controller.ts`.
It:

1. Validates the request body with Zod. The expected shape is:

   ```json
   { "repoUrl": "https://example.com/org/repo.git" }
   ```

2. Creates an ingestion job with `createJob("ingestion")`.
3. Marks the job as `running`.
4. Calls `ingestionService.ingestRepository(repoUrl)`.
5. On success, marks the job as `completed` and returns HTTP `201` with:

   ```ts
   {
     jobId,
     projectId,
     projectName,
     fileCount,
     files
   }
   ```

6. On failure, marks the job as `failed` and returns HTTP `500`.

## Core Service Flow

`ingestRepository(repoUrl)` is the main orchestration function.

It performs this sequence:

1. Derives `repoName` from the last segment of the repo URL, removing a trailing
   `.git` if present.
2. Creates a project row through `ingestionRepo.createProject(repoUrl, repoName)`.
   The initial project status is `pending`.
3. Updates the project status to `ingesting`.
4. Loads source files with `ingestFromGit(repoUrl, project.id)`.
5. Inserts each discovered file into the `files` table through
   `ingestionRepo.insertFile`.
6. Updates the project status to `ingested` and stores the final file count.
7. Creates a Chroma collection for the project.
8. Extracts AST/code chunks from each raw file.
9. Upserts those chunks into the vector store.
10. Returns an `IngestResult`:

    ```ts
    {
      projectId: string;
      projectName: string;
      fileCount: number;
      files: ingestionRepo.ProjectFile[];
    }
    ```

If any step after project creation fails, `ingestRepository` updates the project
status to `failed` and rethrows the original error. The controller then marks the
job as `failed` and returns the error reason to the caller.

## Repository Loading

`ingestFromGit(repoUrl, projectId)` first tries to clone the repository.

The clone target is:

```txt
/tmp/archonai-${projectId}
```

The clone command is:

```sh
git clone --depth 1 --single-branch "<repoUrl>" "<tmpDir>"
```

Important clone settings:

- Timeout: `90_000ms`
- Git prompts disabled with `GIT_TERMINAL_PROMPT=0`
- Only the latest commit of a single branch is cloned

After cloning, the service walks the temporary directory and reads supported
files into memory. Each loaded file has:

```ts
{
  path: string;
  extension: string;
  size: number;
  content: string;
}
```

The temporary clone directory is cleaned up after success or failure.

If cloning fails, ingestion fails with a message starting with
`Failed to clone repository:` followed by the underlying git/process error.

If cloning succeeds but no supported files are found, ingestion fails with a
message that lists the supported extensions. If supported files are discovered
but none can be read, ingestion fails with an explicit read failure message.

## File Filtering

File discovery is handled by `walkDirectory`.

Supported extensions:

- JavaScript: `.js`, `.mjs`, `.cjs`
- TypeScript: `.ts`, `.tsx`, `.mts`
- Java: `.java`
- C#: `.cs`
- SQL: `.sql`
- Data/docs/text: `.json`, `.md`, `.txt`
- Other source files: `.py`, `.go`, `.rb`, `.php`

Skipped directories:

- Dependency/build output: `node_modules`, `dist`, `build`, `bin`, `obj`,
  `target`, `vendor`, `out`, `output`
- VCS/IDE/cache folders: `.git`, `.gradle`, `.idea`, `.vscode`,
  `__pycache__`, `.pytest_cache`, `coverage`, `.nyc_output`
- Frontend generated/static folders: `.next`, `.nuxt`, `public`, `static`

Maximum file size:

```ts
const MAX_FILE_SIZE = 150_000;
```

Files larger than `150_000` bytes are skipped.

## Database Persistence

The ingestion repository lives in
`artifacts/api-server/src/modules/ingestion/repository/ingestion.repository.ts`.

The `projects` table stores:

- `id`
- `repo_url`
- `name`
- `status`
- `file_count`
- `created_at`
- `updated_at`

Status transitions during ingestion:

```txt
pending -> ingesting -> ingested
```

The `files` table stores file metadata:

- `id`
- `project_id`
- `path`
- `extension`
- `size_bytes`
- `created_at`

Full source content is not stored in SQLite. File content is held in memory only
long enough to extract chunks and index them in the vector store.

## AST Chunking

Chunking starts in:

```ts
extractChunks(filePath, content)
```

from `artifacts/api-server/src/services/ast/astChunker.service.ts`.

Language detection is extension-based:

- `.js`, `.mjs`, `.cjs` use the JavaScript chunker.
- `.ts`, `.mts`, `.cts`, `.tsx` use the TypeScript chunker.
- `.java` uses the Java chunker.
- `.cs` uses the C# chunker.
- `.sql` uses the SQL chunker.

JS/TS chunking uses Babel AST parsing. Java, C#, and SQL chunking are
pattern-based.

### What "Extracts AST/Code Chunks" Means

During ingestion, each loaded raw file is passed into:

```ts
const chunks = extractChunks(f.path, f.content);
```

This does not index the entire file as one large text block. Instead, it tries to
split the file into smaller meaningful code units that are easier to retrieve
later with semantic search.

For JavaScript and TypeScript files, the chunker parses the source with Babel and
extracts AST-backed units such as functions, classes, methods, and route handler
blocks. Because these chunks come from parsed syntax, they can include useful
metadata such as the function/class name, source file, line range, HTTP method,
or route path when detected.

For Java, C#, and SQL files, the chunkers use pattern-based parsing rather than a
full AST. They still try to extract meaningful units such as classes, methods,
SQL tables, SQL functions, stored procedures, and views.

Each extracted unit becomes an individual vector-store document. For example, an
Express route handler might become a chunk like:

```ts
{
  id: "...",
  content: "router.post('/', async (req, res) => { ... })",
  metadata: {
    type: "route",
    name: "POST /",
    file: "src/routes/users.js",
    language: "javascript",
    route: "/",
    method: "POST",
    lineStart: 10,
    lineEnd: 15
  }
}
```

This is why later queries such as `"route handler express router"` or
`"authentication middleware JWT token"` can retrieve the most relevant function
or route block instead of forcing downstream agents to scan an entire file.

All chunkers return the same `AstChunk` shape:

```ts
{
  id: string;
  content: string;
  metadata: {
    type: string;
    name: string;
    file: string;
    language: string;
    route?: string;
    method?: string;
    lineStart?: number;
    lineEnd?: number;
    className?: string;
  };
}
```

If `extractChunks` returns no chunks for a file, ingestion falls back to indexing
the first `1500` characters of the raw file content:

```ts
{
  id: `${project.id}::raw::${f.path}`,
  content: f.content.slice(0, 1500),
  metadata: { type: "code", file: f.path }
}
```

## Vector Store Indexing

The vector-store implementation lives in:

```txt
artifacts/api-server/src/services/chroma.service.ts
```

Ingestion creates or reuses a project-scoped collection:

```ts
chroma.createOrGetCollection(project.id);
```

It then upserts all extracted documents:

```ts
chroma.upsertDocuments(project.id, docs);
```

Before upsert, chunk metadata values are converted to strings or `undefined`
because the vector-store metadata interface expects string-like values.

The current Chroma service is not an external ChromaDB server. It is an
in-memory, Chroma-compatible implementation that uses TF-IDF vectors and cosine
similarity for search.

## Downstream Consumers

After ingestion, other modules use the project record, file metadata, and vector
store chunks:

- `/agent/search` queries indexed chunks with `chroma.queryDocuments`.
- `analysis.service.ts` loads project files and queries Chroma for route-related
  semantic context.
- DB schema extraction can add schema documents into the same project collection.
- Lineage, PRD, and HLD flows use project IDs and retrieved context to generate
  higher-level artifacts.

## Failure and Fallback Behavior

Ingestion now fails loudly for repository-level problems instead of silently
using demo data:

- Git clone failures fail the ingestion request and preserve the reason.
- Repositories with zero supported files fail the ingestion request and list the
  supported extensions.
- Repositories with supported files that cannot be read fail the ingestion
  request.

The remaining fallback behavior is file/chunk-level only:

- Individual unreadable files are skipped while other readable files continue.
- Parser errors inside the AST chunker are logged and cause that file to be
  skipped for structured chunks.
- If a file has content but no structured chunks, a raw snippet fallback is
  indexed.

## Important Caveats

- The vector store is in memory, so indexed chunks are lost when the server
  restarts.
- SQLite stores file metadata, not full source content.
- Ingestion does not delete previous projects.
- Ingestion does not deduplicate by repo URL.
- The temporary clone path uses `/tmp/...`, which is Unix-style even when the
  service is run from a Windows workspace.
