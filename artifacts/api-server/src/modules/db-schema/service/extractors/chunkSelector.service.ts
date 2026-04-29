import * as chroma from "../../../../services/chroma.service.js";
import { logger } from "../../../../lib/logger.js";

interface SchemaChunk {
  content: string;
  metadata: Record<string, string | undefined>;
}

type SqlDocType = "sql_table" | "sql_function" | "sql_view" | "unknown";
type SqlEntityKind = "table" | "function" | "procedure" | "view";

export interface SqlSchemaChunks {
  sqlTableDocs: SchemaChunk[];
  sqlFnDocs: SchemaChunk[];
  sqlViewDocs: SchemaChunk[];
}

interface SqlEntityMatch {
  index: number;
  kind: SqlEntityKind;
  type: Exclude<SqlDocType, "unknown">;
}

function normalizeType(type?: string): SqlDocType {
  const normalized = type?.trim().toLowerCase();
  if (!normalized) return "unknown";

  if (normalized === "sql_table" || normalized === "table" || normalized === "db_table") return "sql_table";
  if (
    normalized === "sql_function" ||
    normalized === "sql_procedure" ||
    normalized === "function" ||
    normalized === "procedure"
  ) return "sql_function";
  if (normalized === "sql_view" || normalized === "view") return "sql_view";

  return "unknown";
}

function detectSqlTypeFromContent(content: string): SqlDocType {
  const normalized = content.toLowerCase();
  if (/\bcreate\s+(?:or\s+replace\s+)?table\b/.test(normalized)) return "sql_table";
  if (/\bcreate\s+(?:or\s+replace\s+)?view\b/.test(normalized)) return "sql_view";
  if (/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/.test(normalized)) return "sql_function";
  return "unknown";
}

function resolveDocType(doc: SchemaChunk): SqlDocType {
  const metadataType = normalizeType(doc.metadata["type"]);
  return metadataType !== "unknown" ? metadataType : detectSqlTypeFromContent(doc.content);
}

function normalizeCreateKeyword(keyword: string): SqlEntityKind {
  return keyword.toLowerCase() as SqlEntityKind;
}

function typeFromCreateKeyword(keyword: SqlEntityKind): Exclude<SqlDocType, "unknown"> {
  const normalized = keyword.toLowerCase();
  if (normalized === "table") return "sql_table";
  if (normalized === "view") return "sql_view";
  return "sql_function";
}

function extractEntityName(sql: string, kind?: SqlEntityKind): string | null {
  const entityPattern = kind ?? "TABLE|VIEW|FUNCTION|PROCEDURE";
  const match = sql.match(
    new RegExp(
      "\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:" +
        entityPattern +
        ")\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[`\"']?([\\w.]+)[`\"']?",
      "i",
    ),
  );
  const name = match?.[1]?.split(".").pop()?.replace(/[`"']/g, "").toLowerCase();
  return name || null;
}

function findSqlEntityMatches(sql: string): SqlEntityMatch[] {
  const matches: SqlEntityMatch[] = [];
  const createRegex = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE)\b/gi;

  for (const match of sql.matchAll(createRegex)) {
    const keyword = match[1];
    if (keyword === undefined || match.index === undefined) continue;
    const kind = normalizeCreateKeyword(keyword);
    matches.push({ index: match.index, kind, type: typeFromCreateKeyword(kind) });
  }

  return matches;
}

function expandMultiEntitySqlDoc(doc: SchemaChunk): SchemaChunk[] {
  const matches = findSqlEntityMatches(doc.content);
  if (matches.length <= 1) return [doc];

  return matches.map((match, index) => {
    const nextMatch = matches[index + 1];
    const content = doc.content.slice(match.index, nextMatch?.index).trim();
    const name = extractEntityName(content, match.kind);

    return {
      content,
      metadata: {
        ...doc.metadata,
        type: match.type,
        sqlKind: match.kind,
        name: name ?? doc.metadata["name"],
      },
    };
  });
}

function getLatestVersion(docs: SchemaChunk[]): string | null {
  const versions = docs
    .map((doc) => doc.metadata["version"]?.trim())
    .filter((version): version is string => !!version);

  if (versions.length === 0) return null;

  return versions.sort((a, b) => {
    const numericA = Number(a);
    const numericB = Number(b);
    if (!Number.isNaN(numericA) && !Number.isNaN(numericB)) return numericB - numericA;
    return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
  })[0] ?? null;
}

function dedupeByName(docs: SchemaChunk[]): SchemaChunk[] {
  const seen = new Set<string>();
  const deduped: SchemaChunk[] = [];

  for (const doc of docs) {
    const name = doc.metadata["name"]?.trim().toLowerCase() || extractEntityName(doc.content);
    if (!name) {
      deduped.push(doc);
      continue;
    }

    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(doc);
  }

  return deduped;
}

export function selectSqlSchemaChunks(projectId: string): SqlSchemaChunks {
  const chromaDocs = chroma.getAllDocuments(projectId);
  const latestVersion = getLatestVersion(chromaDocs);
  const docs = latestVersion
    ? chromaDocs.filter((doc) => !doc.metadata["version"] || doc.metadata["version"] === latestVersion)
    : chromaDocs;

  const expandedDocs = docs.flatMap(expandMultiEntitySqlDoc);
  const sqlTableDocs: SchemaChunk[] = [];
  const sqlFnDocs: SchemaChunk[] = [];
  const sqlViewDocs: SchemaChunk[] = [];
  let unknownCount = 0;

  for (const doc of expandedDocs) {
    const type = resolveDocType(doc);
    if (type === "sql_table") sqlTableDocs.push(doc);
    else if (type === "sql_function") sqlFnDocs.push(doc);
    else if (type === "sql_view") sqlViewDocs.push(doc);
    else unknownCount++;
  }

  const result = {
    sqlTableDocs: dedupeByName(sqlTableDocs),
    sqlFnDocs: dedupeByName(sqlFnDocs),
    sqlViewDocs: dedupeByName(sqlViewDocs),
  };

  logger.debug(
    {
      projectId,
      totalDocs: chromaDocs.length,
      filteredDocs: docs.length,
      expandedDocs: expandedDocs.length,
      latestVersion,
      sqlTableChunks: result.sqlTableDocs.length,
      sqlFnChunks: result.sqlFnDocs.length,
      sqlViewChunks: result.sqlViewDocs.length,
      unknownTypeChunks: unknownCount,
    },
    "[DBSchemaAgent] SQL schema chunks classified",
  );

  return result;
}
