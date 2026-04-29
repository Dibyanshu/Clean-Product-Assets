import type * as chroma from "../../../services/chroma.service.js";
import type {
  RawQueryTableUsage,
  RawRelationship,
  RawView,
  SchemaFunction,
  SchemaTable,
} from "./types/schema.types.js";

export interface SchemaEmbeddingInput {
  projectId: string;
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

function columnsText(table: SchemaTable): string {
  return table.columns
    .map((c) => `${c.name} ${c.type}${c.is_primary ? " PRIMARY KEY" : ""}${c.is_nullable ? "" : " NOT NULL"}`)
    .join("; ");
}

function relationshipsText(tableName: string, relationships: RawRelationship[]): string {
  const outgoing = relationships
    .filter((r) => r.fromTable === tableName)
    .map((r) => `${r.fromColumn} references ${r.toTable}.${r.toColumn}`);
  const incoming = relationships
    .filter((r) => r.toTable === tableName)
    .map((r) => `${r.fromTable}.${r.fromColumn} references ${r.toColumn}`);
  const all = [...new Set([...outgoing, ...incoming])];
  return all.length > 0 ? all.join("; ") : "none";
}

function usageHintsText(name: string, queryUsage: RawQueryTableUsage[]): string {
  const hints = queryUsage
    .filter((u) => u.tableName === name || u.sourceName === name)
    .map((u) => `${u.sourceType} ${u.sourceName} ${u.operation}${u.isJoin ? " via JOIN" : ""} ${u.tableName}`);
  const unique = [...new Set(hints)];
  return unique.length > 0 ? unique.join("; ") : "none";
}

function makeDocument(
  projectId: string,
  idPart: string,
  file: string,
  content: string,
): Parameters<typeof chroma.upsertDocuments>[1][number] {
  return {
    id: `${projectId}::schema::${idPart}`,
    content,
    metadata: { type: "schema", file },
  };
}

function pushUnique(
  docs: Parameters<typeof chroma.upsertDocuments>[1],
  seen: Set<string>,
  doc: Parameters<typeof chroma.upsertDocuments>[1][number],
): void {
  if (seen.has(doc.id)) return;
  seen.add(doc.id);
  docs.push(doc);
}

export function buildSchemaEmbeddingDocuments(input: SchemaEmbeddingInput): Parameters<typeof chroma.upsertDocuments>[1] {
  const docs: Parameters<typeof chroma.upsertDocuments>[1] = [];
  const seen = new Set<string>();

  for (const table of input.tables) {
    pushUnique(
      docs,
      seen,
      makeDocument(
        input.projectId,
        `table::${table.name}`,
        `schema/tables/${table.name}`,
        [
          `Schema object: table`,
          `Name: ${table.name}`,
          `Inferred domain: ${inferDomain(table.name)}`,
          `Columns: ${columnsText(table)}`,
          `Relationships: ${relationshipsText(table.name, input.relationships)}`,
          `Usage hints: ${usageHintsText(table.name, input.queryUsage)}`,
        ].join("\n"),
      ),
    );
  }

  for (const fn of input.functions) {
    pushUnique(
      docs,
      seen,
      makeDocument(
        input.projectId,
        `fn::${fn.name}`,
        `schema/functions/${fn.name}`,
        [
          `Schema object: function`,
          `Name: ${fn.name}`,
          `Parameters: ${fn.parameters ?? "none"}`,
          `Description: ${fn.description ?? "none"}`,
          `Usage hints: ${usageHintsText(fn.name, input.queryUsage)}`,
        ].join("\n"),
      ),
    );
  }

  for (const view of input.views) {
    pushUnique(
      docs,
      seen,
      makeDocument(
        input.projectId,
        `view::${view.name}`,
        `schema/views/${view.name}`,
        [
          `Schema object: view`,
          `Name: ${view.name}`,
          `Definition: ${view.definition.slice(0, 1000)}`,
          `Usage hints: ${usageHintsText(view.name, input.queryUsage)}`,
        ].join("\n"),
      ),
    );
  }

  return docs;
}
