import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { getDomain } = require("tldts");
const file = new URL("../app/shared/stonkletsNarrativeBackfill.json", import.meta.url);
const manifest = JSON.parse(readFileSync(file, "utf8"));
const fingerprints = manifest.entries.map(item => {
  const source = item.sources.find(s => s.id === item.leadSourceId) ?? item.sources[0];
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password || !Number.isFinite(Date.parse(source.publishedAt))) throw new Error(`Invalid reviewed source: ${item.id}`);
  item.sourceDomain = getDomain(url.hostname) ?? url.hostname;
  const payload = [item.id, item.pairId, item.headline, item.relation, item.evidence,
    source.url, source.publishedAt, source.title, source.excerpt];
  return `0x${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
});
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
writeFileSync(new URL("../app/shared/stonkletsNarrativeReviews.json", import.meta.url), JSON.stringify(fingerprints, null, 2) + "\n");
console.log(`Indexed ${fingerprints.length} exact editorial reviews; full records remain server-side.`);
