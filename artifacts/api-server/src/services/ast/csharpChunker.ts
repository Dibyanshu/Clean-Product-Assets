/**
 * C# chunker — extracts class declarations and method declarations via
 * pattern-based parsing with brace-depth tracking.
 *
 * Detects ASP.NET attributes: [HttpGet], [HttpPost], [HttpPut], [HttpDelete], [HttpPatch], [Route]
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

function attributesBeforeIdx(content: string, idx: number, maxLookback = 400): string {
  const snippet = content.slice(Math.max(0, idx - maxLookback), idx);
  const lines = snippet.split("\n");
  const attrs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t.startsWith("[") && t.endsWith("]")) attrs.unshift(t);
    else if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    else break;
  }
  return attrs.join(" ");
}

function httpRouteFromAttributes(attrs: string): { route?: string; method?: string } {
  const methodMap: Record<string, string> = {
    HttpGet: "GET", HttpPost: "POST", HttpPut: "PUT",
    HttpDelete: "DELETE", HttpPatch: "PATCH",
  };
  for (const [attr, method] of Object.entries(methodMap)) {
    const m = attrs.match(new RegExp(`\\[${attr}(?:\\s*\\("([^"]*)"\\))?\\]`));
    if (m) {
      const routeMatch = attrs.match(/\[Route\s*\("([^"]*)"\)\]/);
      return { method, route: m[1] ?? routeMatch?.[1] };
    }
  }
  return {};
}

export function extractCsharpChunks(filePath: string, content: string): AstChunk[] {
  const chunks: AstChunk[] = [];

  // Namespace (just detect, useful for metadata)
  const nsRe = /namespace\s+([\w.]+)/g;
  let nsName = "global";
  const nsMatch = nsRe.exec(content);
  if (nsMatch) nsName = nsMatch[1]!;

  // Class declarations
  const classRe = /(?:public|internal|private|protected)?\s*(?:partial\s+|abstract\s+|sealed\s+|static\s+)*class\s+(\w+)(?:\s*:\s*[\w\s,<>]+)?\s*\{/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(content)) !== null) {
    const className = cm[1]!;
    const attrs = attributesBeforeIdx(content, cm.index);
    const isController = className.endsWith("Controller") || attrs.includes("ApiController") || attrs.includes("Controller");
    const braceIdx = content.lastIndexOf("{", cm.index + cm[0].length);
    const block = extractBraceBlock(content, braceIdx);

    chunks.push({
      id: `${filePath}::cs::class::${className}`,
      content: (attrs ? attrs + "\n" : "") + cm[0].trimEnd() + block.slice(0, Math.min(block.length, 1200)),
      metadata: {
        type: isController ? "controller" : "class",
        name: className,
        file: filePath,
        language: "csharp",
        lineStart: lineAt(content, cm.index),
      },
    });
  }

  // Method declarations
  const methodRe = /(?:public|private|protected|internal)\s+(?:override\s+|virtual\s+|abstract\s+|static\s+|async\s+)*(?:[\w<>\[\]?]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:where\s+[^{]+)?\s*\{/g;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(content)) !== null) {
    const methodName = mm[1]!;
    if (["if", "while", "for", "switch", "catch", "using", "lock", "foreach"].includes(methodName)) continue;
    const attrs = attributesBeforeIdx(content, mm.index);
    const { route, method } = httpRouteFromAttributes(attrs);
    const braceIdx = content.indexOf("{", mm.index + mm[0].length - 1);
    const block = extractBraceBlock(content, braceIdx);

    chunks.push({
      id: `${filePath}::cs::method::${methodName}::${mm.index}`,
      content: (attrs ? attrs + "\n" : "") + mm[0].trimEnd() + block.slice(0, Math.min(block.length, 800)),
      metadata: {
        type: route ? "api_endpoint" : "method",
        name: methodName,
        file: filePath,
        language: "csharp",
        ...(route ? { route } : {}),
        ...(method ? { method } : {}),
        lineStart: lineAt(content, mm.index),
      },
    });
  }

  return chunks;
}
