import test from "node:test";
import assert from "node:assert/strict";
import { rootMeta } from "./rootMeta";
test("root metadata uses only the configured origin and valid separate image ratios; missing origin publishes no guessed canonical", () => {
  assert(!rootMeta().includes("fc:miniapp"));
  assert(!rootMeta().includes("og:url"));
  const html = rootMeta("https://launchpad.example");
  assert(html.includes("social-mini.png"));
  assert(html.includes("social-og.png"));
  assert(html.includes("launch_miniapp"));
  assert(html.includes("launch_frame"));
  for (const origin of [
    "https://example.com/path",
    "https://user:secret@example.com",
    "javascript:alert(1)",
    "http://external.example",
    "https://example.com/?x=1",
  ])
    assert.throws(() => rootMeta(origin));
});
