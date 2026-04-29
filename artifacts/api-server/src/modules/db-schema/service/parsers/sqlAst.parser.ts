import { Parser } from "node-sql-parser";
import type { RawFunction, RawRelationship, RawTable } from "../types/schema.types.js";

const parser = new Parser();
const DIALECTS = ["sqlite", "postgresql", "mysql", "transactsql"];

export function astify(sql: string): any[] {
  for (const database of DIALECTS) {
    try {
      const ast = parser.astify(sql, { database });
      return Array.isArray(ast) ? ast : [ast];
    } catch {
    }
  }
  return [];
}

export function normalizeIdentifier(value: unknown): string | null {
  if (typeof value === "string") return value.replace(/[`"']/g, "").toLowerCase();
  if (typeof (value as { value?: unknown } | null)?.value === "string") {
    return String((value as { value: string }).value).replace(/[`"']/g, "").toLowerCase();
  }
  return null;
}

function tableNameFromAst(node: any): string | null {
  const table = node?.table;
  if (Array.isArray(table)) {
    return normalizeIdentifier(table[0]?.table);
  }
  return normalizeIdentifier(table?.table ?? table);
}

function columnNameFromDefinition(def: any): string | null {
  const column = def?.column;
  return normalizeIdentifier(column?.column ?? column);
}

function typeFromDefinition(def: any): string | null {
  const dataType = def?.definition?.dataType ?? def?.definition?.type ?? def?.definition;
  return typeof dataType === "string" && dataType.trim()
    ? dataType.replace(/\(.*\)/, "").toUpperCase()
    : null;
}

function constraintNames(def: any): string[] {
  const constraints: string[] = [];
  if (def?.primary_key || def?.primary || def?.primaryKey) constraints.push("PRIMARY KEY");
  if (def?.nullable?.type === "not null" || def?.nullable?.value === "not null") constraints.push("NOT NULL");
  if (def?.unique) constraints.push("UNIQUE");
  if (def?.reference_definition) constraints.push("FOREIGN KEY");
  return constraints;
}

function referencedColumns(def: any): string[] {
  const values = Array.isArray(def?.definition) ? def.definition : [];
  return values
    .map((entry: any) => normalizeIdentifier(entry?.column ?? entry))
    .filter((name: string | null): name is string => !!name);
}

function referenceDefinition(def: any): any | null {
  return def?.reference_definition?.reference_definition ?? def?.reference_definition ?? def?.references ?? null;
}

function referenceTableName(ref: any): string | null {
  if (Array.isArray(ref?.table)) {
    return normalizeIdentifier(ref.table[0]?.table);
  }
  return normalizeIdentifier(ref?.table?.table ?? ref?.table ?? ref?.references?.table);
}

function referenceColumns(ref: any): string[] {
  const values =
    Array.isArray(ref?.definition) ? ref.definition :
    Array.isArray(ref?.columns) ? ref.columns :
    Array.isArray(ref?.references?.columns) ? ref.references.columns :
    [];
  return values
    .map((entry: any) => normalizeIdentifier(entry?.column ?? entry))
    .filter((name: string | null): name is string => !!name);
}

export function parseCreateTableAst(sql: string): RawTable | null {
  const createNode = astify(sql).find((node) => node?.type === "create" && node?.keyword === "table");
  if (!createNode) return null;

  const table = tableNameFromAst(createNode);
  if (!table) return null;

  const definitions = Array.isArray(createNode.create_definitions) ? createNode.create_definitions : [];
  const columns = new Map<string, RawTable["columns"][number]>();

  for (const def of definitions) {
    if (def?.resource !== "column") continue;
    const name = columnNameFromDefinition(def);
    const type = typeFromDefinition(def);
    if (!name || !type || !/^[a-z_][a-z0-9_]*$/.test(name)) continue;

    const constraints = constraintNames(def);
    const primary = constraints.includes("PRIMARY KEY");
    const nullable = !constraints.includes("NOT NULL") && !primary;
    columns.set(name, { name, type, primary, nullable, constraints });
  }

  for (const def of definitions) {
    if (def?.resource !== "constraint") continue;
    const constraintType = typeof def.constraint_type === "string" ? def.constraint_type.toUpperCase() : "";
    if (constraintType !== "PRIMARY KEY") continue;

    for (const columnName of referencedColumns(def)) {
      const column = columns.get(columnName);
      if (!column) continue;
      column.primary = true;
      column.nullable = false;
      column.constraints = [...new Set([...(column.constraints ?? []), "PRIMARY KEY"])];
    }
  }

  const parsedColumns = Array.from(columns.values());
  return parsedColumns.length > 0 ? { table, columns: parsedColumns } : null;
}

export function parseCreateFunctionAst(sql: string): RawFunction | null {
  const createNode = astify(sql).find((node) => node?.type === "create" && (node?.keyword === "function" || node?.keyword === "procedure"));
  if (!createNode) return null;

  const name = normalizeIdentifier(createNode.name ?? createNode.function ?? createNode.procedure ?? createNode.table?.table);
  if (!name) return null;

  const params = Array.isArray(createNode.args)
    ? createNode.args.map((arg: any) => [normalizeIdentifier(arg?.name), typeFromDefinition(arg)].filter(Boolean).join(" ")).filter(Boolean).join(", ")
    : null;
  const fnType = createNode.keyword === "procedure" ? "Stored Procedure" : "SQL Function";
  return { name, parameters: params || null, description: `${fnType} extracted from SQL source` };
}

export function parseForeignKeyRelationshipsAst(sql: string): RawRelationship[] {
  const createNode = astify(sql).find((node) => node?.type === "create" && node?.keyword === "table");
  if (!createNode) return [];

  const fromTable = tableNameFromAst(createNode);
  if (!fromTable) return [];

  const definitions = Array.isArray(createNode.create_definitions) ? createNode.create_definitions : [];
  const relationships: RawRelationship[] = [];

  for (const def of definitions) {
    if (def?.resource === "column") {
      const fromColumn = columnNameFromDefinition(def);
      const ref = referenceDefinition(def);
      const toTable = referenceTableName(ref);
      const toColumns = referenceColumns(ref);
      if (!fromColumn || !toTable || toColumns.length === 0) continue;
      relationships.push({
        fromTable,
        fromColumn,
        toTable,
        toColumn: toColumns[0]!,
        constraintName: normalizeIdentifier(def?.constraint) ?? null,
      });
      continue;
    }

    if (def?.resource === "constraint") {
      const constraintType = typeof def.constraint_type === "string" ? def.constraint_type.toUpperCase() : "";
      if (!constraintType.includes("FOREIGN KEY")) continue;

      const ref = referenceDefinition(def);
      const toTable = referenceTableName(ref);
      const fromColumns = referencedColumns(def);
      const toColumns = referenceColumns(ref);
      if (!toTable || fromColumns.length === 0 || toColumns.length === 0) continue;

      for (let i = 0; i < fromColumns.length; i++) {
        const fromColumn = fromColumns[i];
        const toColumn = toColumns[i] ?? toColumns[0];
        if (!fromColumn || !toColumn) continue;
        relationships.push({
          fromTable,
          fromColumn,
          toTable,
          toColumn,
          constraintName: normalizeIdentifier(def?.constraint) ?? null,
        });
      }
    }
  }

  return relationships;
}
