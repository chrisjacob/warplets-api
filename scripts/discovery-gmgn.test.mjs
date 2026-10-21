import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gmgnKeyFromVars, syncGmgnKey, gmgnOperatorRequest } from "./discovery-gmgn.mjs";

test("copies only the query key, preserves scoped secrets, rejects conflicting configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "10x-gmgn-")), root = join(dir, "root"), discovery = join(dir, "discovery");
  try {
    writeFileSync(root, 'OTHER_SECRET=never-copy\nGMGN_API_KEY="example-query-key"\nGMGN_PRIVATE_KEY=never-copy\n');
    writeFileSync(discovery, "TENX_ADMIN_TOKEN=keep-private\r\n");
    assert.deepEqual(syncGmgnKey(root, discovery), { key_configured: true, changed: true });
    assert.equal(readFileSync(discovery, "utf8"), "TENX_ADMIN_TOKEN=keep-private\r\nGMGN_API_KEY=example-query-key\r\n");
    assert.deepEqual(syncGmgnKey(root, discovery), { key_configured: true, changed: false });
    writeFileSync(root, "GMGN_API_KEY=different-example-query-key\n"); assert.throws(() => syncGmgnKey(root, discovery), /not overwritten/);
  } finally { unlinkSync(root); unlinkSync(discovery); rmdirSync(dir); }
});
test("rejects duplicate keys, control characters and missing values", () => {
  for (const raw of ["", "GMGN_API_KEY=\n", "GMGN_API_KEY=one-example\nGMGN_API_KEY=two-example", "GMGN_API_KEY=invalid\tkey"]) assert.throws(() => gmgnKeyFromVars(raw));
});
test("operator offers bounded read commands without key arguments or arbitrary URLs", () => {
  const address = "So11111111111111111111111111111111111111112";
  assert.equal(gmgnOperatorRequest(["status"]).method, "GET");
  assert.equal(gmgnOperatorRequest(["probe", address]).body.mode, "access_probe");
  assert.equal(gmgnOperatorRequest(["review",address,"traders"]).body.request.kind,"gmgn_token_traders");
  assert.equal(gmgnOperatorRequest(["activity","10000000-0000-4000-8000-000000000001"]).method,"GET");
  const request = gmgnOperatorRequest(["review", address, "candles"], new Date("2026-10-21T01:00:22.000Z")).body.request;
  assert.equal(request.end_at, "2026-10-21T01:00:00.000Z");
  assert.equal(Date.parse(request.end_at) - Date.parse(request.start_at), 21_600_000);
  for (const args of [["swap", address], ["review", address, "https://evil.test"], ["probe", address, "extra"]]) assert.throws(() => gmgnOperatorRequest(args));
});
