/**
 * AST Chunker orchestrator.
 *
 * Language detection (from file extension):
 *   .js .mjs .cjs        → JS chunker  (Babel real AST)
 *   .ts .mts .cts .tsx   → TS chunker  (Babel real AST, typescript plugin)
 *   .java                → Java chunker (pattern-based)
 *   .cs                  → C# chunker  (pattern-based)
 *   .sql                 → SQL chunker (pattern-based)
 *
 * All chunkers return the same AstChunk format — normalised so ChromaDB
 * receives consistent metadata regardless of source language.
 *
 * To swap any chunker for tree-sitter when native binaries are available,
 * only the corresponding *Chunker.ts file needs to change — this file stays the same.
 */

import { logger } from "../../lib/logger.js";
import type { AstChunk } from "./types.js";
import { extractJsChunks } from "./jsChunker.js";
import { extractJavaChunks } from "./javaChunker.js";
import { extractCsharpChunks } from "./csharpChunker.js";
import { extractSqlChunks } from "./sqlChunker.js";

const IGNORED_DIRS = /\/(node_modules|build|dist|bin|obj|\.git|\.next|__pycache__)\//;

export type { AstChunk };

export function detectLanguage(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (IGNORED_DIRS.test(lower)) return null;
  if (/\.(js|mjs|cjs)$/.test(lower)) return "javascript";
  if (/\.(ts|mts|cts|tsx)$/.test(lower)) return "typescript";
  if (/\.java$/.test(lower)) return "java";
  if (/\.cs$/.test(lower)) return "csharp";
  if (/\.sql$/.test(lower)) return "sql";
  return null;
}

export function extractChunks(filePath: string, content: string): AstChunk[] {
  const language = detectLanguage(filePath);
  if (!language) return [];

  try {
    switch (language) {
      case "javascript": return extractJsChunks(filePath, content, false);
      case "typescript": return extractJsChunks(filePath, content, true);
      case "java":       return extractJavaChunks(filePath, content);
      case "csharp":     return extractCsharpChunks(filePath, content);
      case "sql":        return extractSqlChunks(filePath, content);
      default:           return [];
    }
  } catch (err) {
    logger.warn({ filePath, language, err }, "[ASTChunker] Parser error — skipping file");
    return [];
  }
}
