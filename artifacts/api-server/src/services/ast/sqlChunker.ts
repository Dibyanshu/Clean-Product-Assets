/**
 * SQL chunker — extracts CREATE TABLE, CREATE PROCEDURE, CREATE FUNCTION, CREATE VIEW.
 * Uses pattern matching with brace/statement-boundary detection.
 */

import type { AstChunk } from "./types.js";

function lineAt(content: string, idx: number): number {
  return content.slice(0, idx).split("\n").length;
}

function extractBlock(content: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === "(") depth++;
    else if (content[i] === ")") { depth--; if (depth === 0) return content.slice(openIdx, i + 1); }
  }
  return content.slice(openIdx, Math.min(openIdx + 2000, content.length));
}

function extractUntilSemicolon(content: string, startIdx: number): string {
  const end = content.indexOf(";", startIdx);
  return end === -1 ? content.slice(startIdx) : content.slice(startIdx, end + 1);
}

export function extractSqlChunks(filePath: string, content: string): AstChunk[] {
  const chunks: AstChunk[] = [];
  const upper = content.toUpperCase();

  const patterns: Array<{ re: RegExp; type: string }> = [
    { re: /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi, type: "table" },
    { re: /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(\w+)\s*\(/gi, type: "procedure" },
    { re: /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(/gi, type: "function" },
    { re: /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)\s+AS\b/gi, type: "view" },
  ];

  for (const { re, type } of patterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const name = m[1]!;
      const startIdx = m.index;
      const parenIdx = content.indexOf("(", startIdx);

      let blockContent: string;
      if (type === "view") {
        blockContent = extractUntilSemicolon(content, startIdx);
      } else if (parenIdx !== -1) {
        blockContent = extractUntilSemicolon(content, startIdx);
      } else {
        blockContent = extractUntilSemicolon(content, startIdx);
      }

      if (blockContent.length < 5) continue;

      chunks.push({
        id: `${filePath}::sql::${type}::${name}`,
        content: blockContent.trim(),
        metadata: {
          type: `sql_${type}`,
          name,
          file: filePath,
          language: "sql",
          lineStart: lineAt(content, startIdx),
        },
      });
    }
  }

  return chunks;
}
