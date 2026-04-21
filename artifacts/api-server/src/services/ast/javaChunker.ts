/**
 * Java chunker — extracts class declarations and method declarations via
 * pattern-based parsing with brace-depth tracking.
 *
 * Detects Spring annotations: @RestController, @Controller,
 *                              @GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @RequestMapping
 */

import type { AstChunk } from "./types.js";

function lineAt(content: string, idx: number): number {
  return content.slice(0, idx).split("\n").length;
}

function extractBraceBlock(content: string, openBrace: number): string {
  let depth = 0;
  for (let i = openBrace; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") { depth--; if (depth === 0) return content.slice(openBrace, i + 1); }
  }
  return content.slice(openBrace, Math.min(openBrace + 3000, content.length));
}

function annotationsBeforeIdx(content: string, idx: number, maxLookback = 400): string {
  const snippet = content.slice(Math.max(0, idx - maxLookback), idx);
  const lines = snippet.split("\n");
  const annots: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t.startsWith("@")) annots.unshift(t);
    else if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    else break;
  }
  return annots.join(" ");
}

function httpRouteFromAnnotations(annots: string): { route?: string; method?: string } {
  const methodMap: Record<string, string> = {
    GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT",
    DeleteMapping: "DELETE", PatchMapping: "PATCH", RequestMapping: "ANY",
  };
  for (const [annot, method] of Object.entries(methodMap)) {
    const m = annots.match(new RegExp(`@${annot}\\s*(?:\\("([^"]*)"\\))?`));
    if (m) return { method, route: m[1] };
  }
  return {};
}

export function extractJavaChunks(filePath: string, content: string): AstChunk[] {
  const chunks: AstChunk[] = [];

  // Class declarations
  const classRe = /(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w\s,<>]+)?\s*\{/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(content)) !== null) {
    const className = cm[1]!;
    const braceIdx = content.indexOf("{", cm.index + cm[0].length - 1);
    const block = extractBraceBlock(content, braceIdx);
    const annots = annotationsBeforeIdx(content, cm.index);
    const isController = annots.includes("Controller");

    chunks.push({
      id: `${filePath}::java::class::${className}`,
      content: (annots ? annots + "\n" : "") + cm[0].trimEnd() + block.slice(0, Math.min(block.length, 1200)),
      metadata: {
        type: isController ? "controller" : "class",
        name: className,
        file: filePath,
        language: "java",
        lineStart: lineAt(content, cm.index),
      },
    });
  }

  // Method declarations
  const methodRe = /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(content)) !== null) {
    const methodName = mm[1]!;
    if (["if", "while", "for", "switch", "catch", "try"].includes(methodName)) continue;
    const annots = annotationsBeforeIdx(content, mm.index);
    const { route, method } = httpRouteFromAnnotations(annots);
    const braceIdx = content.indexOf("{", mm.index + mm[0].length - 1);
    const block = extractBraceBlock(content, braceIdx);

    chunks.push({
      id: `${filePath}::java::method::${methodName}::${mm.index}`,
      content: (annots ? annots + "\n" : "") + mm[0].trimEnd() + block.slice(0, Math.min(block.length, 800)),
      metadata: {
        type: route ? "api_endpoint" : "method",
        name: methodName,
        file: filePath,
        language: "java",
        ...(route ? { route } : {}),
        ...(method ? { method } : {}),
        lineStart: lineAt(content, mm.index),
      },
    });
  }

  return chunks;
}
