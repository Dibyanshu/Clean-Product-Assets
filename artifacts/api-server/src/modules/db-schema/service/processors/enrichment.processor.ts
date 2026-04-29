import type {
  RawQueryTableUsage,
  RawRelationship,
  RawView,
  SchemaFunction,
  SchemaTable,
} from "../types/schema.types.js";

export interface EnrichedSchemaDoc {
  idPart: string;
  content: string;
  file: string;
}

export interface EnrichSchemaInput {
  tables: SchemaTable[];
  functions: SchemaFunction[];
  relationships: RawRelationship[];
  views: RawView[];
  queryUsage: RawQueryTableUsage[];
}

function inferDomain(name: string): string {
  const normalized = name.toLowerCase();
  if (/user|account|profile|session|role|permission|auth/.test(normalized)) return "identity";
  if (/product|catalog|sku|inventory|stock|category/.test(normalized)) return "catalog";
  if (/order|cart|checkout|payment|invoice|shipment/.test(normalized)) return "commerce";
  if (/audit|log|event|history/.test(normalized)) return "audit";
  return "core";
}

function relationshipText(tableName: string, relationships: RawRelationship[]): string {
  const outgoing = relationships
    .filter((r) => r.fromTable === tableName)
    .map((r) => `${r.fromColumn} -> ${r.toTable}.${r.toColumn}`);
  const incoming = relationships
    .filter((r) => r.toTable === tableName)
    .map((r) => `${r.fromTable}.${r.fromColumn} -> ${r.toColumn}`);

  const parts: string[] = [];
  if (outgoing.length > 0) parts.push(`outgoing relationships: ${outgoing.join("; ")}`);
  if (incoming.length > 0) parts.push(`incoming relationships: ${incoming.join("; ")}`);
  return parts.join(". ");
}

function usageText(name: string, queryUsage: RawQueryTableUsage[]): string {
  const usages = queryUsage
    .filter((u) => u.tableName === name || u.sourceName === name)
    .map((u) => `${u.sourceType}:${u.sourceName} ${u.operation}${u.isJoin ? " join" : ""} ${u.tableName}`);
  return usages.length > 0 ? `usage context: ${[...new Set(usages)].join("; ")}` : "";
}

export function enrichSchemaForEmbedding(input: EnrichSchemaInput): EnrichedSchemaDoc[] {
  const docs: EnrichedSchemaDoc[] = [];

  for (const table of input.tables) {
    const colText = table.columns
      .map((c) => `${c.name} ${c.type}${c.is_primary ? " PRIMARY KEY" : ""}${c.is_nullable ? "" : " NOT NULL"}`)
      .join(", ");
    const domain = inferDomain(table.name);
    const relText = relationshipText(table.name, input.relationships);
    const useText = usageText(table.name, input.queryUsage);
    const context = [relText, useText].filter(Boolean).join(". ");

    docs.push({
      idPart: `table::${table.name}`,
      content: `Table ${table.name}: ${colText}. inferred domain: ${domain}${context ? `. ${context}` : ""}`,
      file: `schema/tables/${table.name}`,
    });
  }

  for (const fn of input.functions) {
    const useText = usageText(fn.name, input.queryUsage);
    docs.push({
      idPart: `fn::${fn.name}`,
      content: `Function ${fn.name}(${fn.parameters ?? ""}) - ${fn.description ?? ""}${useText ? `. ${useText}` : ""}`,
      file: `schema/functions/${fn.name}`,
    });
  }

  for (const view of input.views) {
    const useText = usageText(view.name, input.queryUsage);
    docs.push({
      idPart: `view::${view.name}`,
      content: `View ${view.name}: ${view.definition.slice(0, 1000)}${useText ? `. ${useText}` : ""}`,
      file: `schema/views/${view.name}`,
    });
  }

  return docs;
}
