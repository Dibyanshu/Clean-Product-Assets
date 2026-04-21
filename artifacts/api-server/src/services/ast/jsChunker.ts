/**
 * JS/TS chunker — uses @babel/parser for a real AST.
 *
 * Extracts:
 *  - FunctionDeclaration
 *  - ArrowFunctionExpression assigned to a variable or object property
 *  - ClassDeclaration (whole class)
 *  - ClassMethod / ObjectMethod
 *  - Express / Fastify route calls: app.get, router.post, fastify.put, etc.
 */

import { parse } from "@babel/parser";
import traversePkg from "@babel/traverse";
import type { AstChunk } from "./types.js";

// Handle CJS default export in ESM context
const traverse = (traversePkg as unknown as { default: typeof traversePkg }).default ?? traversePkg;

const ROUTE_CALLEE_OBJECTS = new Set(["app", "router", "server", "fastify", "api", "route"]);
const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "all", "use"]);

function nodeContent(code: string, node: { start?: number | null; end?: number | null }): string {
  if (node.start == null || node.end == null) return "";
  return code.slice(node.start, Math.min(node.end, node.start + 1200));
}

function lineAt(code: string, idx: number | null | undefined): number | undefined {
  if (idx == null) return undefined;
  return code.slice(0, idx).split("\n").length;
}

export function extractJsChunks(filePath: string, content: string, isTs = false): AstChunk[] {
  const chunks: AstChunk[] = [];
  let ast: ReturnType<typeof parse>;

  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: isTs
        ? ["typescript", "decorators-legacy", "classProperties", "dynamicImport"]
        : ["jsx", "classProperties", "dynamicImport"],
      errorRecovery: true,
    });
  } catch {
    // Fallback: try script mode
    try {
      ast = parse(content, {
        sourceType: "script",
        plugins: ["jsx", "classProperties"],
        errorRecovery: true,
      });
    } catch {
      return []; // Unparseable — return empty
    }
  }

  const seen = new Set<string>();

  function addChunk(chunk: AstChunk) {
    if (!seen.has(chunk.id) && chunk.content.trim().length > 10) {
      seen.add(chunk.id);
      chunks.push(chunk);
    }
  }

  traverse(ast, {
    // Named function declarations: function foo() { ... }
    FunctionDeclaration(path: any) {
      const name = path.node.id?.name ?? "anonymous";
      addChunk({
        id: `${filePath}::js::fn::${name}::${path.node.start}`,
        content: nodeContent(content, path.node),
        metadata: {
          type: "function",
          name,
          file: filePath,
          language: isTs ? "typescript" : "javascript",
          lineStart: lineAt(content, path.node.start),
          lineEnd: lineAt(content, path.node.end),
        },
      });
    },

    // const foo = () => { ... } or const foo = function() { ... }
    VariableDeclaration(path: any) {
      for (const decl of path.node.declarations) {
        const name = decl.id.type === "Identifier" ? decl.id.name : "anon";
        const init = decl.init;
        if (!init) continue;
        if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
          addChunk({
            id: `${filePath}::js::var_fn::${name}::${path.node.start}`,
            content: nodeContent(content, path.node),
            metadata: {
              type: "function",
              name,
              file: filePath,
              language: isTs ? "typescript" : "javascript",
              lineStart: lineAt(content, path.node.start),
            },
          });
        }
      }
    },

    // class Foo { ... }
    ClassDeclaration(path: any) {
      const name = path.node.id?.name ?? "AnonymousClass";
      addChunk({
        id: `${filePath}::js::class::${name}`,
        content: nodeContent(content, path.node),
        metadata: {
          type: "class",
          name,
          file: filePath,
          language: isTs ? "typescript" : "javascript",
          lineStart: lineAt(content, path.node.start),
        },
      });
    },

    // class methods
    ClassMethod(path: any) {
      const className =
        (path.findParent((p: any) => p.isClassDeclaration()) as any)?.node?.id?.name ?? "UnknownClass";
      const key = path.node.key;
      const methodName = key.type === "Identifier" ? key.name : "anonymous";
      addChunk({
        id: `${filePath}::js::method::${className}.${methodName}::${path.node.start}`,
        content: nodeContent(content, path.node),
        metadata: {
          type: "method",
          name: `${className}.${methodName}`,
          file: filePath,
          language: isTs ? "typescript" : "javascript",
          lineStart: lineAt(content, path.node.start),
          className,
        },
      });
    },

    // Express/Fastify routes: router.get('/path', handler)
    ExpressionStatement(path: any) {
      const expr = path.node.expression;
      if (expr.type !== "CallExpression") return;
      const callee = expr.callee;
      if (callee.type !== "MemberExpression") return;
      const obj = callee.object;
      const prop = callee.property;
      if (obj.type !== "Identifier" || prop.type !== "Identifier") return;
      if (!ROUTE_CALLEE_OBJECTS.has(obj.name) || !HTTP_METHODS.has(prop.name)) return;

      const firstArg = expr.arguments[0];
      const routePath =
        firstArg && firstArg.type === "StringLiteral" ? firstArg.value : "unknown";

      addChunk({
        id: `${filePath}::js::route::${prop.name.toUpperCase()}::${routePath}::${path.node.start}`,
        content: nodeContent(content, path.node),
        metadata: {
          type: "route",
          name: `${prop.name.toUpperCase()} ${routePath}`,
          file: filePath,
          language: isTs ? "typescript" : "javascript",
          method: prop.name.toUpperCase(),
          lineStart: lineAt(content, path.node.start),
        },
      });
    },
  });
  return chunks;
}
