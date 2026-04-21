import { logger } from "../../../lib/logger.js";
import * as lineageRepo from "../repository/lineage.repository.js";
import * as analysisRepo from "../../analysis/repository/analysis.repository.js";
import * as ingestionRepo from "../../ingestion/repository/ingestion.repository.js";
import * as chroma from "../../../services/chroma.service.js";

type SqlOperation = lineageRepo.SqlOperation;

export interface LineageTableRef {
  name: string;
  operation: SqlOperation;
  confidence: number;
}

export interface LineageEntry {
  api: {
    id: string;
    method: string;
    path: string;
    handler: string | null;
  };
  tables: LineageTableRef[];
  flow: string[];
  status: "mapped" | "partial" | "unknown";
}

export interface LineageResult {
  projectId: string;
  apiCount: number;
  mappedCount: number;
  partialCount: number;
  unknownCount: number;
  entries: LineageEntry[];
}

// SQL reserved words that should not be treated as table names
const SQL_RESERVED = new Set([
  "select", "insert", "update", "delete", "from", "into", "table", "index",
  "view", "where", "and", "or", "not", "null", "true", "false", "join",
  "left", "right", "inner", "outer", "on", "as", "group", "order", "by",
  "having", "limit", "offset", "distinct", "count", "sum", "avg", "min",
  "max", "set", "values", "current_timestamp", "datetime", "now", "all",
  "any", "case", "when", "then", "else", "end", "exists", "between",
  "like", "in", "is", "union", "except", "intersect", "create", "drop",
  "alter", "primary", "foreign", "key", "references", "unique", "check",
  "default", "constraint", "index", "trigger", "procedure", "function",
]);

interface SqlRef {
  table: string;
  operation: SqlOperation;
  confidence: number;
}

function extractSqlRefs(content: string): SqlRef[] {
  const refs: SqlRef[] = [];
  const seen = new Set<string>();

  const addRef = (table: string, op: SqlOperation, conf: number) => {
    const t = table.toLowerCase();
    const key = `${t}::${op}`;
    if (!seen.has(key) && !SQL_RESERVED.has(t) && t.length > 1 && /^[a-z_][a-z0-9_]*$/.test(t)) {
      seen.add(key);
      refs.push({ table: t, operation: op, confidence: conf });
    }
  };

  // Raw SQL — direct matches (confidence 1.0)
  const rawPatterns: Array<{ re: RegExp; op: SqlOperation; g: number; conf: number }> = [
    { re: /SELECT\s+[\w\s\*,\.`"[\]]+\s+FROM\s+[`"[]?(\w+)[`"\]]?/gi, op: "SELECT", g: 1, conf: 1.0 },
    { re: /INSERT\s+INTO\s+[`"[]?(\w+)[`"\]]?/gi, op: "INSERT", g: 1, conf: 1.0 },
    { re: /UPDATE\s+[`"[]?(\w+)[`"\]]?\s+SET/gi, op: "UPDATE", g: 1, conf: 1.0 },
    { re: /DELETE\s+FROM\s+[`"[]?(\w+)[`"\]]?/gi, op: "DELETE", g: 1, conf: 1.0 },
  ];

  for (const { re, op, g, conf } of rawPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      addRef(m[g]!, op, conf);
    }
  }

  // Prisma ORM (confidence 0.85)
  const prismaPatterns: Array<{ re: RegExp; op: SqlOperation }> = [
    { re: /prisma\.(\w+)\.(findMany|findAll|findOne|findFirst|findUnique|findUniqueOrThrow)\s*\(/gi, op: "SELECT" },
    { re: /prisma\.(\w+)\.(create|createMany)\s*\(/gi, op: "INSERT" },
    { re: /prisma\.(\w+)\.(update|updateMany|upsert)\s*\(/gi, op: "UPDATE" },
    { re: /prisma\.(\w+)\.(delete|deleteMany)\s*\(/gi, op: "DELETE" },
  ];
  for (const { re, op } of prismaPatterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) addRef(m[1]!, op, 0.85);
  }

  // Knex (confidence 0.75)
  const knexRe = /knex\s*\(\s*['"](\w+)['"]\s*\)/gi;
  knexRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = knexRe.exec(content)) !== null) addRef(m[1]!, "QUERY", 0.75);

  // db.query / db.run with inline SQL strings (confidence 0.9 — SQL found in code strings)
  const dbQueryRe = /db\.(query|run)\s*\(\s*['"`](SELECT\s+[\w\s\*,\.]+FROM\s+(\w+)|INSERT\s+INTO\s+(\w+)|UPDATE\s+(\w+)\s+SET|DELETE\s+FROM\s+(\w+))/gi;
  dbQueryRe.lastIndex = 0;
  while ((m = dbQueryRe.exec(content)) !== null) {
    const sql = m[2]!.toUpperCase();
    const tbl = (m[3] ?? m[4] ?? m[5] ?? m[6])!;
    if (!tbl) continue;
    if (sql.startsWith("SELECT")) addRef(tbl, "SELECT", 0.9);
    else if (sql.startsWith("INSERT")) addRef(tbl, "INSERT", 0.9);
    else if (sql.startsWith("UPDATE")) addRef(tbl, "UPDATE", 0.9);
    else if (sql.startsWith("DELETE")) addRef(tbl, "DELETE", 0.9);
  }

  return refs;
}

function extractFunctionCalls(content: string): string[] {
  const calls: string[] = [];
  const seen = new Set<string>();

  const dataMethodWords = "find|create|update|delete|save|get|list|insert|remove|destroy|fetch|load|query|search|add|put|patch|upsert|count|exists";

  // ClassName.method() — PascalCase class
  const classMethodRe = new RegExp(`\\b([A-Z][a-zA-Z0-9]*)\\.(${dataMethodWords})\\w*\\s*\\(`, "gi");
  let m: RegExpExecArray | null;
  while ((m = classMethodRe.exec(content)) !== null) {
    const key = `${m[1]}.${m[2]}`;
    if (!seen.has(key)) { seen.add(key); calls.push(key); }
  }

  // service/repo/dao variables
  const svcRe = new RegExp(`\\b(\\w+(?:Service|Repo|Repository|DAO|Dao))\\.(${dataMethodWords})\\w*\\s*\\(`, "gi");
  while ((m = svcRe.exec(content)) !== null) {
    const key = `${m[1]}.${m[2]}`;
    if (!seen.has(key)) { seen.add(key); calls.push(key); }
  }

  return calls;
}

function inferOperation(httpMethod: string): SqlOperation {
  switch (httpMethod.toUpperCase()) {
    case "GET": return "SELECT";
    case "POST": return "INSERT";
    case "PUT": case "PATCH": return "UPDATE";
    case "DELETE": return "DELETE";
    default: return "QUERY";
  }
}

export async function generateLineage(projectId: string): Promise<LineageResult> {
  const project = await ingestionRepo.findProjectById(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  await lineageRepo.clearLineageForProject(projectId);
  logger.info({ projectId }, "[LineageAgent] Cleared previous lineage");

  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) {
    return { projectId, apiCount: 0, mappedCount: 0, partialCount: 0, unknownCount: 0, entries: [] };
  }

  // --- Step 1: Build function → SQL refs map from all vector store chunks ---
  const allChunks = chroma.queryDocuments(
    projectId,
    "function class method query database select insert update delete sql",
    200,
  );

  const fnSqlMap = new Map<string, SqlRef[]>();

  const addFnSqlRef = (key: string, refs: SqlRef[]) => {
    if (refs.length === 0) return;
    const k = key.toLowerCase();
    const existing = fnSqlMap.get(k) ?? [];
    const merged = [...existing];
    for (const r of refs) {
      const dup = merged.find((e) => e.table === r.table && e.operation === r.operation);
      if (!dup) merged.push(r);
    }
    fnSqlMap.set(k, merged);
  };

  for (const chunk of allChunks) {
    const refs = extractSqlRefs(chunk.content);
    if (refs.length === 0) continue;

    const name = (chunk.metadata.name as string | undefined) ?? "";
    const className = (chunk.metadata.className as string | undefined) ?? "";

    if (name) addFnSqlRef(name, refs);
    if (className && name) addFnSqlRef(`${className}.${name}`, refs);
    // Also store by file:name for cross-file matching
    const file = (chunk.metadata.file as string | undefined) ?? "";
    if (file && name) {
      const base = file.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
      if (base) addFnSqlRef(`${base}.${name}`, refs);
    }
  }

  logger.info({ projectId, fnCount: fnSqlMap.size }, "[LineageAgent] Function→SQL map built");

  // Store function_table_map
  for (const [fnName, refs] of fnSqlMap.entries()) {
    for (const ref of refs) {
      await lineageRepo.insertFunctionTableMap(projectId, fnName, ref.table, ref.operation, ref.confidence);
    }
  }

  // --- Step 2: For each API, resolve tables ---
  const entries: LineageEntry[] = [];

  for (const api of apis) {
    const handlerName = api.handler ?? `${api.method} ${api.path}`;
    await lineageRepo.insertApiFunctionMap(projectId, api.id, handlerName, 1.0);

    const tableRefs = new Map<string, { operation: SqlOperation; confidence: number }>();
    const flow: string[] = [handlerName];

    const setTableRef = (table: string, op: SqlOperation, conf: number) => {
      const key = `${table}::${op}`;
      if (!tableRefs.has(key)) tableRefs.set(key, { operation: op, confidence: conf });
    };

    const resolveFromFnMap = (fnKey: string, conf: number): boolean => {
      const k = fnKey.toLowerCase();
      const refs = fnSqlMap.get(k);
      if (refs && refs.length > 0) {
        for (const r of refs) setTableRef(r.table, r.operation, Math.min(r.confidence, conf));
        return true;
      }
      return false;
    };

    // a) Exact handler match
    resolveFromFnMap(handlerName, 1.0);

    // b) Partial handler name match (method portion only)
    const handlerMethod = handlerName.split(".").pop() ?? handlerName;
    if (tableRefs.size === 0) {
      for (const [fnKey, refs] of fnSqlMap.entries()) {
        const fnMethod = fnKey.split(".").pop() ?? fnKey;
        if (fnMethod === handlerMethod.toLowerCase()) {
          for (const r of refs) setTableRef(r.table, r.operation, Math.min(r.confidence, 0.8));
          if (!flow.includes(fnKey)) flow.push(fnKey);
        }
      }
    }

    // c) Scan matching AST chunks for SQL and function calls
    if (tableRefs.size === 0) {
      const routeQuery = `${api.method} ${api.path} route handler function`;
      const routeChunks = chroma.queryDocuments(projectId, routeQuery, 8);

      for (const chunk of routeChunks.slice(0, 5)) {
        // Direct SQL in chunk
        const directRefs = extractSqlRefs(chunk.content);
        for (const r of directRefs) setTableRef(r.table, r.operation, r.confidence);

        // Function calls from this chunk → resolve via fnSqlMap
        const fnCalls = extractFunctionCalls(chunk.content);
        for (const call of fnCalls) {
          const resolved = resolveFromFnMap(call, 0.85);
          if (resolved && !flow.includes(call)) flow.push(call);
        }
      }
    }

    // d) Last resort — infer from path + HTTP method
    if (tableRefs.size === 0) {
      const pathParts = api.path
        .replace(/^\/api\//, "")
        .split("/")
        .filter((s) => s && !s.startsWith(":") && !s.startsWith("{"));
      if (pathParts.length > 0) {
        const resource = pathParts[0]!.toLowerCase().replace(/-/g, "_");
        const inferredOp = inferOperation(api.method);
        setTableRef(resource, inferredOp, 0.4);
        flow.push("[inferred from path]");
      }
    }

    // Persist api_table_map
    const tables: LineageTableRef[] = [];
    for (const [key, { operation, confidence }] of tableRefs.entries()) {
      const tableName = key.split("::")[0]!;
      await lineageRepo.insertApiTableMap(projectId, api.id, tableName, operation, confidence);
      tables.push({ name: tableName, operation, confidence });
    }

    const avgConf = tables.length > 0 ? tables.reduce((s, t) => s + t.confidence, 0) / tables.length : 0;
    const status: "mapped" | "partial" | "unknown" =
      tables.length === 0 ? "unknown" : avgConf >= 0.8 ? "mapped" : "partial";

    entries.push({ api: { id: api.id, method: api.method, path: api.path, handler: api.handler }, tables, flow, status });
  }

  const result: LineageResult = {
    projectId,
    apiCount: apis.length,
    mappedCount: entries.filter((e) => e.status === "mapped").length,
    partialCount: entries.filter((e) => e.status === "partial").length,
    unknownCount: entries.filter((e) => e.status === "unknown").length,
    entries,
  };

  logger.info(
    { projectId, mapped: result.mappedCount, partial: result.partialCount, unknown: result.unknownCount },
    "[LineageAgent] Lineage generation complete",
  );

  return result;
}

export async function getLineage(projectId: string): Promise<LineageResult | null> {
  const apis = await analysisRepo.listApisByProject(projectId);
  if (apis.length === 0) return null;

  const apiTableMaps = await lineageRepo.getApiTableMaps(projectId);
  if (apiTableMaps.length === 0) return null;

  const apiFunctionMaps = await lineageRepo.getApiFunctionMaps(projectId);

  const entries: LineageEntry[] = apis.map((api) => {
    const tableRows = apiTableMaps.filter((m) => m.api_id === api.id);
    const fnRows = apiFunctionMaps.filter((m) => m.api_id === api.id);

    const flow: string[] = [api.handler ?? `${api.method} ${api.path}`];
    for (const fn of fnRows) {
      if (!flow.includes(fn.function_name)) flow.push(fn.function_name);
    }

    const tables: LineageTableRef[] = tableRows.map((t) => ({
      name: t.table_name,
      operation: t.operation as SqlOperation,
      confidence: t.confidence,
    }));

    const avgConf = tables.length > 0 ? tables.reduce((s, t) => s + t.confidence, 0) / tables.length : 0;
    const status: "mapped" | "partial" | "unknown" =
      tables.length === 0 ? "unknown" : avgConf >= 0.8 ? "mapped" : "partial";

    return { api: { id: api.id, method: api.method, path: api.path, handler: api.handler }, tables, flow, status };
  });

  return {
    projectId,
    apiCount: apis.length,
    mappedCount: entries.filter((e) => e.status === "mapped").length,
    partialCount: entries.filter((e) => e.status === "partial").length,
    unknownCount: entries.filter((e) => e.status === "unknown").length,
    entries,
  };
}
