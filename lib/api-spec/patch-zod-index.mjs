import { writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const root = resolve(__dirname, "..", "..");

const typesDir = resolve(root, "lib", "api-zod", "src", "generated", "types");
const typesIndexPath = resolve(typesDir, "index.ts");
const conflictFile = resolve(typesDir, "getDbTableRowsParams.ts");
const zodIndexPath = resolve(root, "lib", "api-zod", "src", "index.ts");

if (existsSync(conflictFile)) {
  unlinkSync(conflictFile);
  console.log("[patch-zod-index] Removed conflicting getDbTableRowsParams.ts");
}

if (existsSync(typesIndexPath)) {
  let content = readFileSync(typesIndexPath, "utf8");
  content = content
    .split("\n")
    .filter((line) => !line.includes("getDbTableRowsParams"))
    .join("\n");
  writeFileSync(typesIndexPath, content, "utf8");
  console.log("[patch-zod-index] Patched types/index.ts to remove conflicting export");
}

const desired = `export * from "./generated/api";\nexport * from "./generated/types";\n`;
writeFileSync(zodIndexPath, desired, "utf8");
console.log("[patch-zod-index] Restored api-zod/src/index.ts");
