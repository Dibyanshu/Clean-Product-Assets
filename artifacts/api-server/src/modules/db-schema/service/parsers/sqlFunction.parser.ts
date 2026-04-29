import type { RawFunction } from "../types/schema.types.js";
import { parseCreateFunctionAst } from "./sqlAst.parser.js";

function parseCreateFunctionRegex(sql: string): RawFunction | null {
  const nameMatch = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[`"']?(\w+)[`"']?\s*\(/i);
  if (!nameMatch || !nameMatch[1]) return null;

  const fnName = nameMatch[1].toLowerCase();
  const parenStart = sql.indexOf("(");
  let parenEnd = -1;
  let depth = 0;
  for (let i = parenStart; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) { parenEnd = i; break; } }
  }
  const params = parenEnd === -1 ? null : sql.slice(parenStart + 1, parenEnd).trim() || null;

  const fnType = /PROCEDURE/i.test(sql) ? "Stored Procedure" : "SQL Function";
  return { name: fnName, parameters: params, description: `${fnType} extracted from SQL source` };
}

export function parseCreateFunction(sql: string): RawFunction | null {
  return parseCreateFunctionAst(sql) ?? parseCreateFunctionRegex(sql);
}
