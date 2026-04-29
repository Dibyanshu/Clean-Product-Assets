import type { RawTable } from "../types/schema.types.js";
import { parseCreateTableAst } from "./sqlAst.parser.js";

function parseCreateTableRegex(sql: string): RawTable | null {
  const nameMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?\s*\(/i);
  if (!nameMatch || !nameMatch[1]) return null;

  const tableName = nameMatch[1].toLowerCase();
  const parenStart = sql.indexOf("(");
  if (parenStart === -1) return null;

  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) { parenEnd = i; break; } }
  }

  const body = parenEnd === -1 ? sql.slice(parenStart + 1) : sql.slice(parenStart + 1, parenEnd);

  const columns: RawTable["columns"] = [];
  const lines = body.split(/,\s*\n|,\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const clean = line.replace(/--.*$/, "").trim();
    if (!clean) continue;

    const upper = clean.toUpperCase();
    if (upper.startsWith("PRIMARY KEY") || upper.startsWith("UNIQUE") || upper.startsWith("FOREIGN KEY") ||
        upper.startsWith("INDEX") || upper.startsWith("KEY") || upper.startsWith("CONSTRAINT") ||
        upper.startsWith("CHECK")) continue;

    const parts = clean.split(/\s+/);
    if (parts.length < 2) continue;

    const colName = parts[0]!.replace(/[`"']/g, "").toLowerCase();
    const colType = parts[1]!.replace(/\(.*\)/, "").toUpperCase();
    const isPrimary = upper.includes("PRIMARY KEY");
    const isNullable = !upper.includes("NOT NULL") && !isPrimary;

    if (colName && colType && /^[a-z_][a-z0-9_]*$/.test(colName)) {
      columns.push({ name: colName, type: colType, primary: isPrimary, nullable: isNullable });
    }
  }

  return columns.length > 0 ? { table: tableName, columns } : null;
}

export function parseCreateTable(sql: string): RawTable | null {
  return parseCreateTableAst(sql) ?? parseCreateTableRegex(sql);
}
