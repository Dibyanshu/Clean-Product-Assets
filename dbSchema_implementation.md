# DB Schema Implementation

## Overview

The DB schema flow extracts database tables, columns, and SQL functions for an
ingested project. It reads SQL chunks from the project vector store, parses
`CREATE TABLE`, `CREATE FUNCTION`, and `CREATE PROCEDURE` statements, persists
the extracted schema in SQLite, and indexes a natural-language schema summary
back into the vector store for downstream agents.

The main implementation lives in:

```txt
artifacts/api-server/src/modules/db-schema/service/dbSchema.service.ts
```

## Entrypoint Flow

The routes are registered in `artifacts/api-server/src/routes/agent.ts`:

```ts
fastify.post("/agent/extract-db-schema", extractDbSchemaHandler);
fastify.get("/agent/projects/:projectId/db-schema", getDbSchemaHandler);
```

`extractDbSchemaHandler` lives in:

```txt
artifacts/api-server/src/modules/db-schema/controller/dbSchema.controller.ts
```

It:

1. Validates the request body with Zod.
2. Requires:

   ```json
   { "projectId": "..." }
   ```

3. Creates a `db-schema` job.
4. Marks the job as `running`.
5. Calls `dbSchemaService.extractSchema(projectId)`.
6. On success, marks the job as `completed` and returns HTTP `201` with table
   and function counts plus the extracted schema.
7. On failure, marks the job as `failed` and returns HTTP `500`.

`getDbSchemaHandler` loads the latest stored schema using
`dbSchemaService.getSchema(projectId)`. If no schema exists yet, it returns:

```json
{ "tables": [], "functions": [], "extractedAt": null }
```

## Core Service Flow

`extractSchema(projectId)` performs the extraction.

It follows this sequence:

1. Verifies the project exists through `ingestionRepo.findProjectById`.
2. Deletes any existing schema rows for the project.
3. Captures a single `extractedAt` timestamp for this run.
4. Reads all project documents from Chroma with `chroma.getAllDocuments(projectId)`.
5. Selects SQL table chunks where `metadata.type === "sql_table"`.
6. Selects SQL function/procedure chunks where `metadata.type` is `sql_function`
   or `sql_procedure`.
7. Parses SQL chunks into raw table/function objects.
8. Falls back to built-in demo schema data if no SQL table chunks exist.
9. Persists extracted tables, columns, and functions in SQLite.
10. Converts the persisted schema into concise text documents.
11. Upserts those schema documents into the project Chroma collection.
12. Returns an `ExtractResult`.

Return shape:

```ts
{
  projectId: string;
  tables: SchemaTable[];
  functions: SchemaFunction[];
  extractedAt: string;
}
```

## SQL Chunk Source

DB schema extraction depends on ingestion having indexed SQL chunks first.

During ingestion, `.sql` files are sent to:

```txt
artifacts/api-server/src/services/ast/sqlChunker.ts
```

The SQL chunker identifies statements such as:

- `CREATE TABLE`
- `CREATE PROCEDURE`
- `CREATE FUNCTION`
- `CREATE VIEW`

It creates Chroma documents with metadata types:

- `sql_table`
- `sql_procedure`
- `sql_function`
- `sql_view`

`dbSchema.service.ts` currently consumes table, function, and procedure chunks.
Views are indexed by ingestion but are not persisted by DB schema extraction.

## Table Parsing

`parseCreateTable(sql)` parses a single SQL table chunk.

It supports table statements shaped like:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL
);
```

Parsing behavior:

- Extracts the table name from `CREATE TABLE`.
- Lowercases the table name.
- Finds the column body inside the first matching parentheses block.
- Splits column definitions by comma/newline patterns.
- Skips table-level constraints and indexes such as:
  - `PRIMARY KEY`
  - `UNIQUE`
  - `FOREIGN KEY`
  - `INDEX`
  - `KEY`
  - `CONSTRAINT`
  - `CHECK`
- Extracts each column name and type.
- Lowercases column names.
- Uppercases column types.
- Marks a column as primary if the line includes `PRIMARY KEY`.
- Marks a column nullable unless it includes `NOT NULL` or is primary.

Parsed raw table shape:

```ts
{
  table: string;
  columns: Array<{
    name: string;
    type: string;
    primary?: boolean;
    nullable?: boolean;
  }>;
}
```

If no valid columns are found, the table chunk is ignored.

## Function and Procedure Parsing

`parseCreateFunction(sql)` parses `CREATE FUNCTION` and `CREATE PROCEDURE`
chunks.

It:

- Extracts the function/procedure name.
- Lowercases the name.
- Extracts the parameter text from the first matching parentheses block.
- Sets the description to either:
  - `SQL Function extracted from SQL source`
  - `Stored Procedure extracted from SQL source`

Parsed raw function shape:

```ts
{
  name: string;
  parameters: string | null;
  description: string;
}
```

## Database Persistence

The repository lives in:

```txt
artifacts/api-server/src/modules/db-schema/repository/dbSchema.repository.ts
```

Before writing a new extraction result, `deleteSchemaForProject(projectId)`:

- Deletes columns for existing project tables.
- Deletes existing project table rows.
- Deletes existing project function rows.

Tables are stored in `db_tables`:

- `id`
- `project_id`
- `name`
- `extracted_at`

Columns are stored in `db_columns`:

- `id`
- `table_id`
- `name`
- `type`
- `is_primary`
- `is_nullable`

Functions and procedures are stored in `db_functions`:

- `id`
- `project_id`
- `name`
- `parameters`
- `description`
- `created_at`

IDs are generated with `crypto.randomUUID()` in the service.

## Vector Store Indexing

After persistence, the extracted schema is indexed back into Chroma.

The service ensures a collection exists:

```ts
chroma.createOrGetCollection(projectId);
```

Each table becomes a document like:

```txt
Table users: id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL
```

with metadata:

```ts
{
  type: "schema",
  file: "schema/tables/users"
}
```

Each function becomes a document like:

```txt
Function calculate_order_total(order_id TEXT) - SQL Function extracted from SQL source
```

with metadata:

```ts
{
  type: "schema",
  file: "schema/functions/calculate_order_total"
}
```

These schema documents are used later by search, lineage, PRD, and HLD flows as
retrievable semantic context.

## Fallback Behavior

If no `sql_table` chunks are found in Chroma, extraction uses built-in fallback
schema data from `FALLBACK_SCHEMA` and `FALLBACK_FUNCTIONS`.

The fallback includes demo tables such as:

- `users`
- `sessions`
- `products`
- `orders`
- `order_items`

and demo functions such as:

- `get_user_by_email`
- `get_active_sessions`
- `calculate_order_total`

This means DB schema extraction can still produce a schema even when ingestion
did not find SQL files. Check logs to know whether extraction came from real SQL
chunks or fallback data.

## Retrieval Flow

`getSchema(projectId)` reads previously stored schema from SQLite.

It:

1. Loads tables ordered by name.
2. Loads columns for each table ordered by primary-key columns first, then name.
3. Loads functions ordered by name.
4. Uses the latest table `extracted_at` value as `extractedAt`.
5. Returns `null` if no table rows exist for the project.

`getDbSchemaHandler` converts `null` into an empty schema response for the API.

## Important Caveats

- Extraction depends on SQL chunks already being present in Chroma from
  ingestion.
- If no SQL table chunks exist, fallback schema is used instead of failing.
- SQL parsing is regex/pattern-based, not a full SQL parser.
- Table-level constraints are skipped and not persisted.
- Foreign-key relationships are not stored.
- SQL views are chunked by ingestion but not persisted by DB schema extraction.
- Existing schema rows for a project are deleted before each new extraction.
- Schema documents are added to the in-memory Chroma store, so they are lost when
  the server restarts.


