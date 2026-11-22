import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function assertClosedTenxRelease(manifest, assets, appSource, config) {
  assert(manifest["src/App.tsx"], "Missing home app build; build app/dist first");
  assert(!JSON.stringify(manifest).match(/(?:^|[\\/"'])meme[\\/]/), "Local launchpad code is present in the production app manifest");
  assert(!Object.entries(manifest).some(([key, value]) => key.includes("src/discovery/") || /DiscoveryPage|AttentionContent|LaunchCurveLab|LaunchRecoveryLab/.test(value.name ?? "")), "Unfinished 10X code is present in the release manifest");
  assert(!assets.some(name => /^(?:DiscoveryPage|AttentionContent|LaunchCurveLab|LaunchRecoveryLab)-/.test(name)), "Unfinished 10X assets remain in app/dist");
  assert(appSource.includes("P8tnl7sodII") && appSource.includes("The 10X Thesis"), "The working thesis page must remain in the home build");
  const vars = config.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  assert(/^TENX_APP_ENABLED\s*=\s*"false"\s*$/m.test(vars), "The production server exposure flag must remain false for this thesis-only release");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(root, "app/dist");
  const manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8"));
  assertClosedTenxRelease(manifest, readdirSync(resolve(dist, "assets")), readFileSync(resolve(dist, manifest["src/App.tsx"]?.file ?? "missing-app-build"), "utf8"), readFileSync(resolve(root, "app/wrangler.toml"), "utf8"));
  console.log("Thesis-only release passed: thesis retained, unfinished 10X assets absent, server flag closed.");
}
