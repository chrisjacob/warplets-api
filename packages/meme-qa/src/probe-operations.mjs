/** CI-only actual Wrangler/HTTP probe. Never run against saved user QA state. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  operatorRequest,
  statusExitCode,
} from "../../../meme/scripts/operator-client.mjs";
if (
  process.env.CI !== "true" ||
  process.env.MEME_QA_DISPOSABLE_OPERATIONS !== "true"
)
  throw Error("Explicit disposable CI operations fixture required");
const origin = "http://127.0.0.1:8799",
  token = readFileSync(
    resolve(
      import.meta.dirname,
      "../../../meme/.wrangler/restricted-qa-operator/operator-token",
    ),
    "utf8",
  ).trim();
const call = (path, body, method = "POST") =>
  operatorRequest(
    origin,
    token,
    "/api/meme/operator/operations/" + path,
    body,
    method,
  );
const before = await call("health", undefined, "GET");
assert.equal(before.scope, "local-preview");
assert.equal(before.productionReady, false);
assert.equal(before.round, null);
assert.equal(before.transactions.total, 0);
assert.equal(before.operations.jobs.total, 0);
assert.equal(
  before.sources.collecting + before.sources.ready + before.sources.blocked,
  0,
);
assert.equal(
  before.transactions.unknown +
    before.transactions.staleSubmitted +
    before.transactions.unfinalized,
  0,
);
assert(before.controls.every((c) => !c.paused && c.version === 0));
assert(before.sources.budgets.every((b) => b.ceiling === 0 && b.used === 0));
let checked = 0;
for (const name of ["serving", "participation", "operations", "collection"]) {
  const payload = {
    key: randomUUID(),
    name,
    paused: true,
    expectedVersion: 0,
    reason: "Disposable CI HTTP pause",
  };
  const paused = await call("controls", payload);
  assert.equal(paused.control.paused, true);
  assert.equal(paused.control.version, 1);
  const replay = await call("controls", payload);
  assert.equal(replay.replayed, true);
  assert.equal(replay.control.version, 1);
  if (name === "serving")
    assert.equal(
      (await fetch(origin + "/api/meme/state?view=today")).status,
      503,
    );
  if (name === "participation")
    assert.equal(
      (await (await fetch(origin + "/api/meme/state?view=today")).json())
        .participationPaused,
      true,
    );
  if (name === "operations")
    assert.equal((await call("tick", {})).state, "paused");
  const resumed = await call("controls", {
    ...payload,
    key: randomUUID(),
    paused: false,
    expectedVersion: 1,
  });
  assert.equal(resumed.control.paused, false);
  assert.equal(resumed.control.version, 2);
  checked++;
}
const after = await call("health", undefined, "GET");
assert.equal(statusExitCode(after), 0);
assert.deepEqual(after.sources.budgets, before.sources.budgets);
assert.equal((await fetch(origin + "/api/meme/state?view=today")).status, 200);
assert.deepEqual(after.financialActions, {
  launching: false,
  funding: false,
  claims: false,
});
console.log(
  JSON.stringify({
    version: 1,
    layer: "local-wrangler-http",
    controlsChecked: checked,
    idempotentReplays: checked,
    providerRequests: 0,
    financialTransactions: 0,
    productionReady: false,
  }),
);
