import type { RawQueryTableUsage, RawView } from "../types/schema.types.js";
import { astify, normalizeIdentifier } from "./sqlAst.parser.js";

function dedupeUsage(usages: RawQueryTableUsage[]): RawQueryTableUsage[] {
  const seen = new Set<string>();
  const deduped: RawQueryTableUsage[] = [];
  for (const usage of usages) {
    const key = `${usage.sourceType}:${usage.sourceName}:${usage.tableName}:${usage.operation}:${usage.isJoin ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(usage);
  }
  return deduped;
}

function sourceLabel(sourceType: string, sourceName: string): Pick<RawQueryTableUsage, "sourceType" | "sourceName"> {
  return { sourceType: sourceType.toLowerCase(), sourceName: sourceName.toLowerCase() };
}

function tableFromNode(node: any): string | null {
  return normalizeIdentifier(node?.table?.table ?? node?.table);
}

function collectSelectUsage(selectNode: any, sourceType: string, sourceName: string): RawQueryTableUsage[] {
  const usage: RawQueryTableUsage[] = [];
  const source = sourceLabel(sourceType, sourceName);
  const from = Array.isArray(selectNode?.from) ? selectNode.from : [];

  for (const entry of from) {
    const tableName = tableFromNode(entry);
    if (!tableName) continue;
    const isJoin = typeof entry?.join === "string";
    usage.push({
      ...source,
      tableName,
      operation: isJoin ? "JOIN" : "SELECT",
      isJoin,
    });
  }

  return usage;
}

function collectInsertUsage(insertNode: any, sourceType: string, sourceName: string): RawQueryTableUsage[] {
  const usage: RawQueryTableUsage[] = [];
  const source = sourceLabel(sourceType, sourceName);
  const table = Array.isArray(insertNode?.table) ? insertNode.table[0] : insertNode?.table;
  const tableName = tableFromNode(table);

  if (tableName) {
    usage.push({ ...source, tableName, operation: "INSERT", isJoin: false });
  }

  if (insertNode?.values?.type === "select") {
    usage.push(...collectSelectUsage(insertNode.values, sourceType, sourceName));
  }

  return usage;
}

function parseCreateViewRegex(sql: string): RawView | null {
  const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+[`"']?(\w+)[`"']?\s+AS\s+([\s\S]+?);?$/i);
  if (!match?.[1]) return null;
  return {
    name: match[1].toLowerCase(),
    definition: sql.trim(),
  };
}

function parseQueryTableUsageRegex(sql: string, sourceType: string, sourceName: string): RawQueryTableUsage[] {
  const source = sourceLabel(sourceType, sourceName);
  const usage: RawQueryTableUsage[] = [];

  for (const match of sql.matchAll(/\bINSERT\s+INTO\s+[`"']?(\w+)[`"']?/gi)) {
    const tableName = normalizeIdentifier(match[1]);
    if (tableName) usage.push({ ...source, tableName, operation: "INSERT", isJoin: false });
  }

  for (const match of sql.matchAll(/\bFROM\s+[`"']?(\w+)[`"']?/gi)) {
    const tableName = normalizeIdentifier(match[1]);
    if (tableName) usage.push({ ...source, tableName, operation: "SELECT", isJoin: false });
  }

  for (const match of sql.matchAll(/\bJOIN\s+[`"']?(\w+)[`"']?/gi)) {
    const tableName = normalizeIdentifier(match[1]);
    if (tableName) usage.push({ ...source, tableName, operation: "JOIN", isJoin: true });
  }

  return dedupeUsage(usage);
}

export function parseCreateView(sql: string): RawView | null {
  const createNode = astify(sql).find((node) => node?.type === "create" && node?.keyword === "view");
  const name = normalizeIdentifier(createNode?.view?.view ?? createNode?.view);
  if (name) {
    return { name, definition: sql.trim() };
  }

  return parseCreateViewRegex(sql);
}

export function parseQueryTableUsage(sql: string, sourceType: string, sourceName: string): RawQueryTableUsage[] {
  const usage: RawQueryTableUsage[] = [];
  const nodes = astify(sql);

  for (const node of nodes) {
    if (node?.type === "create" && node?.keyword === "view" && node?.select) {
      usage.push(...collectSelectUsage(node.select, sourceType, sourceName));
    } else if (node?.type === "select") {
      usage.push(...collectSelectUsage(node, sourceType, sourceName));
    } else if (node?.type === "insert") {
      usage.push(...collectInsertUsage(node, sourceType, sourceName));
    }
  }

  return usage.length > 0 ? dedupeUsage(usage) : parseQueryTableUsageRegex(sql, sourceType, sourceName);
}
