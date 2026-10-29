import assert from "node:assert/strict";
import { test } from "node:test";
import { assertClosedTenxRelease } from "./check-tenx-release.mjs";

const manifest = { "src/App.tsx": { file: "assets/App-closed.js", name: "App" } };
const thesis = "The 10X Thesis P8tnl7sodII";
const config = '[vars]\nTENX_APP_ENABLED = "false"\n[env.preview.vars]\nTENX_APP_ENABLED = "true"\n';
test("accepts the closed release independently of a preview flag", () => {
  assert.doesNotThrow(() => assertClosedTenxRelease(manifest, ["App-closed.js"], thesis, config));
});
test("rejects open or missing production configuration and absent thesis content", () => {
  for (const unsafe of [config.replace('"false"', '"true"'), '[env.preview.vars]\nTENX_APP_ENABLED = "false"']) assert.throws(() => assertClosedTenxRelease(manifest, [], thesis, unsafe));
  assert.throws(() => assertClosedTenxRelease(manifest, [], "empty home", config));
  assert.throws(() => assertClosedTenxRelease({}, [], thesis, config));
});
test("rejects an enabled or stale hidden-product artifact even when configuration is closed", () => {
  assert.throws(() => assertClosedTenxRelease({ ...manifest, "src/discovery/DiscoveryPage.tsx": { file: "assets/DiscoveryPage-open.js" } }, [], thesis, config));
  assert.throws(() => assertClosedTenxRelease(manifest, ["DiscoveryPage-stale.js"], thesis, config));
});
