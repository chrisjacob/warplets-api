import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const ROOT = path.resolve(SCRIPT_DIR, "..");
const files = [path.join(ROOT, "wrangler.toml"), path.join(ROOT, "app", "wrangler.toml")];

const requiredSecrets = [
  "ACTION_SESSION_SECRET",
  "ADMIN_API_KEYS_JSON",
  "NEYNAR_API_KEY",
  "RESEND_API_KEY",
];

function parseBindings(content) {
  const ids = [...content.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  const dbIds = [...content.matchAll(/^\s*database_id\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  return { ids, dbIds };
}

function hasPlaceholder(values) {
  return values.some((value) => value.startsWith("REPLACE_WITH_"));
}

let failed = false;

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const { ids, dbIds } = parseBindings(content);
  if (hasPlaceholder([...ids, ...dbIds])) {
    failed = true;
    console.error(`[security-preflight] Placeholder binding ID found in ${path.relative(ROOT, file)}.`);
  }
}

const appWrangler = fs.readFileSync(path.join(ROOT, "app", "wrangler.toml"), "utf8");
const appBindings = parseBindings(appWrangler);
if (new Set(appBindings.ids).size !== appBindings.ids.length) {
  failed = true;
  console.error("[security-preflight] Duplicate KV namespace IDs detected in app/wrangler.toml.");
}
if (new Set(appBindings.dbIds).size !== appBindings.dbIds.length) {
  failed = true;
  console.error("[security-preflight] Duplicate D1 database IDs detected in app/wrangler.toml.");
}

console.log("[security-preflight] Required environment secrets:");
for (const secret of requiredSecrets) {
  console.log(` - ${secret}`);
}
console.log("[security-preflight] Ensure each secret is scoped per environment (prod/preview/dev).");

if (failed) {
  process.exit(1);
}

console.log("[security-preflight] Passed.");
