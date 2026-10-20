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

// Per-file caps miss startup regressions spread over multiple shared chunks.
// Follow static imports only: opening connection options may load more on demand.
const manifest = JSON.parse(readFileSync(join(distAssets, "..", ".vite", "manifest.json"), "utf8"));
const startup = new Set();
function visitStartup(key) {
  if (startup.has(key)) return;
  startup.add(key);
  if (!manifest[key]) throw new Error(`Missing startup manifest entry: ${key}`);
  for (const dependency of manifest[key].imports ?? []) visitStartup(dependency);
}
visitStartup("src/App.tsx");
const startupFiles = new Set([...startup].map(key => manifest[key].file).filter(file => file.endsWith(".js")));
const startupGzip = [...startupFiles].reduce((total, file) => total + gzipSync(readFileSync(join(distAssets, "..", file))).length, 0);
if (startupGzip > 250 * 1024) failures.push(`Home shell static startup is ${(startupGzip / 1024).toFixed(1)} KiB gzip (limit 250 KiB)`);
for (const key of startup) if (["WebConnectModal", "walletTrade"].includes(manifest[key].name)) failures.push(`${manifest[key].name} must stay outside the home shell's static startup graph`);
console.log(`Home shell static startup: ${(startupGzip / 1024).toFixed(1)} KiB gzip across ${startupFiles.size} chunks.`);

if (failures.length > 0) {
  console.error("Performance budget failed:\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log("Performance budget passed.");
