import type { RawRelationship } from "../types/schema.types.js";
import { parseForeignKeyRelationshipsAst } from "./sqlAst.parser.js";

function normalizeIdentifier(value: string): string {
  return value.replace(/[`"']/g, "").trim().toLowerCase();
}

function tableName(sql: string): string | null {
  const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(/i);
  return match?.[1] ? normalizeIdentifier(match[1]) : null;
}

function tableBody(sql: string): string | null {
  const parenStart = sql.indexOf("(");
  if (parenStart === -1) return null;

  let depth = 0;
  for (let i = parenStart; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return sql.slice(parenStart + 1, i);
    }
  }

  return sql.slice(parenStart + 1);
}

function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }

  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

function splitColumns(value: string): string[] {
  return value
    .split(",")
    .map((v) => normalizeIdentifier(v))
    .filter(Boolean);
}

function parseForeignKeyRelationshipsRegex(sql: string): RawRelationship[] {
  const fromTable = tableName(sql);
  const body = tableBody(sql);
  if (!fromTable || !body) return [];

  const relationships: RawRelationship[] = [];
  const definitions = splitDefinitions(body);

  for (const def of definitions) {
    const clean = def.replace(/--.*$/, "").trim();
    if (!clean) continue;

    const tableLevel = clean.match(
      /^(?:CONSTRAINT\s+[`"']?(\w+)[`"']?\s+)?FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i,
    );
    if (tableLevel) {
      const constraintName = tableLevel[1] ? normalizeIdentifier(tableLevel[1]) : null;
      const fromColumns = splitColumns(tableLevel[2] ?? "");
      const toTable = normalizeIdentifier(tableLevel[3] ?? "");
      const toColumns = splitColumns(tableLevel[4] ?? "");

      for (let i = 0; i < fromColumns.length; i++) {
        const fromColumn = fromColumns[i];
        const toColumn = toColumns[i] ?? toColumns[0];
        if (!fromColumn || !toTable || !toColumn) continue;
        relationships.push({ fromTable, fromColumn, toTable, toColumn, constraintName });
      }
      continue;
    }

    const inline = clean.match(/^([`"']?\w+[`"']?)\s+.+?\s+REFERENCES\s+[`"']?(\w+)[`"']?\s*\(([^)]+)\)/i);
    if (inline) {
      const fromColumn = normalizeIdentifier(inline[1] ?? "");
      const toTable = normalizeIdentifier(inline[2] ?? "");
      const toColumn = splitColumns(inline[3] ?? "")[0];
      if (!fromColumn || !toTable || !toColumn) continue;
      relationships.push({ fromTable, fromColumn, toTable, toColumn, constraintName: null });
    }
  }

  return relationships;
}

export function parseForeignKeyRelationships(sql: string): RawRelationship[] {
  const astRelationships = parseForeignKeyRelationshipsAst(sql);
  return astRelationships.length > 0 ? astRelationships : parseForeignKeyRelationshipsRegex(sql);
}
