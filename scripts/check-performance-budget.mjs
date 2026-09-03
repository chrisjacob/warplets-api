import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const distAssets = join(repoRoot, "app", "dist", "assets");
const searchSourcePath = join(repoRoot, "app", "src", "SearchApp.tsx");
const stonkletsSourcePath = join(repoRoot, "app", "src", "StonkletsApp.tsx");
const maxJavascriptGzipBytes = 350 * 1024;
const largeAssetWarningBytes = 500 * 1024;
const failures = [];

for (const name of readdirSync(distAssets)) {
  const path = join(distAssets, name);
  if (!statSync(path).isFile()) continue;
  const bytes = readFileSync(path);
  if (name.endsWith(".js")) {
    const gzipBytes = gzipSync(bytes).byteLength;
    if (gzipBytes > maxJavascriptGzipBytes) {
      failures.push(`${name} is ${(gzipBytes / 1024).toFixed(1)} KiB gzip (limit 350 KiB)`);
    }
  }
  if (bytes.byteLength > largeAssetWarningBytes && !name.endsWith(".wasm")) {
    console.warn(`[performance] large asset: ${name} (${(bytes.byteLength / 1024).toFixed(1)} KiB)`);
  }
}

const searchSource = readFileSync(searchSourcePath, "utf8");
if (!searchSource.includes('import("@sqlite.org/sqlite-wasm")')) {
  failures.push("SQLite must remain dynamically imported");
}
if (/import\s+sqlite3InitModule\s+from\s+["']@sqlite\.org\/sqlite-wasm["']/.test(searchSource)) {
  failures.push("SQLite has regressed to a static runtime import");
}
if (!searchSource.includes("const SEARCH_RESULT_PAGE_SIZE = 100")) {
  failures.push("Search SQL page size must remain capped at 100");
}
if (searchSource.includes("const SEARCH_RESULT_LIMIT = 10000")) {
  failures.push("Search must not restore the 10,000-row materialization limit");
}
const stonkletsSource = readFileSync(stonkletsSourcePath, "utf8");
if (!stonkletsSource.includes('import("lightweight-charts")')) {
  failures.push("Lightweight Charts must remain dynamically imported by Stonklets");
}
if (/^import\s+.*from\s+["']lightweight-charts["']/m.test(stonkletsSource)) {
  failures.push("Lightweight Charts has regressed to a static runtime import");
}

if (failures.length > 0) {
  console.error("Performance budget failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Performance budget passed.");
