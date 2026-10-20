import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Read-only local benchmark. No refresh endpoints, tokens or provider calls.
const root = resolve(import.meta.dirname, ".."), report = { measured_at: new Date().toISOString(), api: [], bundles: [] };
const manifest = JSON.parse(readFileSync(resolve(root, "app/dist/.vite/manifest.json"), "utf8"));
for (const entry of ["src/App.tsx", "src/discovery/DiscoveryPage.tsx"]) {
  const visited = new Set(), files = new Set();
  function visit(key) { if (visited.has(key)) return; visited.add(key); const item = manifest[key]; if (!item) throw Error(`Missing manifest entry ${key}`); if (item.file.endsWith(".js")) files.add(item.file); for (const child of item.imports ?? []) visit(child); }
  visit(entry);
  let raw = 0, gzip = 0;
  for (const file of files) { const bytes = readFileSync(resolve(root, "app/dist", file)); raw += bytes.length; gzip += gzipSync(bytes).length; }
  report.bundles.push({ entry, static_chunks: files.size, raw_bytes: raw, gzip_bytes: gzip, files: [...files].sort() });
}
for (const path of ["backing", "candidates?limit=100&age=24h", "candidates?limit=100&age=24h&view=cards", "discovery/coverage"]) {
  const times = []; let bytes = 0, status = 0;
  for (let i = 0; i < 4; i++) { const start = performance.now(), r = await fetch(`http://127.0.0.1:8794/api/10x/${path}`, { signal: AbortSignal.timeout(20000) }); const body = await r.text(); times.push(Math.round(performance.now() - start)); bytes = Buffer.byteLength(body); status = r.status; }
  report.api.push({ path, status, bytes, runs_ms: times, warm_median_ms: times.slice(1).sort((a, b) => a - b)[1] });
}
if (process.argv[2]) writeFileSync(resolve(root, process.argv[2]), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
