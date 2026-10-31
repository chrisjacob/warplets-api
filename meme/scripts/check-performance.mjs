import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
const dist = resolve(import.meta.dirname, "../dist"),
  manifest = JSON.parse(
    readFileSync(resolve(dist, ".vite/manifest.json"), "utf8"),
  ),
  seen = new Set();
function visit(key) {
  if (seen.has(key)) return;
  seen.add(key);
  for (const dependency of manifest[key].imports ?? []) visit(dependency);
}
for (const [key, value] of Object.entries(manifest))
  if (value.isEntry) visit(key);
if (!seen.size) throw Error("Production entry missing");
if (
  [...seen].some((key) =>
    /ConnectDialog|TrustConnectBridge|FarcasterSignInControl|HistoryPanel|RewardsPanel|GuideDialog/.test(key),
  )
)
  throw Error("Deferred wallet or archive views entered the startup graph");
const assets = [
  ...new Set(
    [...seen].flatMap((key) => [
      manifest[key].file,
      ...(manifest[key].css ?? []),
    ]),
  ),
];
const bytes = assets.reduce(
  (sum, file) => sum + gzipSync(readFileSync(resolve(dist, file))).length,
  0,
);
console.log(
  `Launchpad static startup: ${(bytes / 1024).toFixed(1)} KiB gzip across ${assets.length} assets (80 KiB budget).`,
);
if (bytes > 80 * 1024) throw Error("Launchpad startup budget exceeded");
