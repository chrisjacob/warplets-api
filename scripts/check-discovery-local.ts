import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HistoryResponse, ListResponse, ReviewsResponse, StatusResponse } from "../app/src/discovery/client";
import { analyzeHolders, HolderEvidenceSchema } from "../discovery/src/holders";
import { creationProof, migrations, verifyState } from "../discovery/src/pump";
import { AccountsSchema, TransactionSchema } from "../discovery/src/rpc";
import { hashJson } from "../discovery/src/solana";

const base = "http://127.0.0.1:8794/api/10x";
async function get(path: string) {
  const response = await fetch(`${base}/${path}`);
  assert.equal(response.status, 200, path); assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}
const list = ListResponse.parse(await get("candidates?limit=100"));
const status = StatusResponse.parse(await get("system/status"));
assert.ok(list.data.candidates.length <= 100);
assert.ok(list.data.candidates.every(c => c.mode === "live" && c.launch_eligible === false));
for (const usage of status.data.usage) {
  assert.ok(usage.used <= status.data.daily_limits[usage.provider as "rpc" | "market"]);
}
assert.equal((await fetch(`${base}/admin/jobs`)).status, 401);
let paired = 0, accountSnapshots = 0;
for (const candidate of list.data.candidates.slice(0, 4)) {
  if (!candidate.creation || !candidate.graduation) continue;
  const origin = await get(`evidence/${candidate.creation.signature}`);
  const migration = await get(`evidence/${candidate.graduation.signature}`);
  assert.equal(await hashJson(origin.data.payload), candidate.creation.payload_hash);
  assert.equal(await hashJson(migration.data.payload), candidate.graduation.payload_hash);
  assert.equal((await creationProof(TransactionSchema.parse(origin.data.payload), candidate.address, candidate.creation.fetched_at))?.proof.signature, candidate.creation.signature);
  const event = (await migrations(TransactionSchema.parse(migration.data.payload))).find(m => m.address === candidate.address && m.pool === candidate.pool);
  assert.ok(event); paired++;
  if (candidate.risk.payload_hash) {
    const state = await get(`account-evidence/${candidate.risk.payload_hash}`);
    assert.equal(await hashJson(state.data.payload), candidate.risk.payload_hash);
    const risk = await verifyState(event, AccountsSchema.parse(state.data.payload), candidate.risk.observed_at!, candidate.graduation.slot);
    assert.equal(risk.context_slot, candidate.risk.context_slot); accountSnapshots++;
  }
}
let holderSnapshots = 0;
for (const candidate of list.data.candidates.filter(c => c.holders?.payload_hash).slice(0, 3)) {
  const saved = await get(`holder-evidence/${candidate.holders!.payload_hash}`);
  const payload = HolderEvidenceSchema.parse(saved.data.payload);
  assert.equal(await hashJson(payload), candidate.holders!.payload_hash);
  const replayed = await analyzeHolders(payload, candidate.holders!.observed_at);
  assert.deepEqual(replayed, candidate.holders); holderSnapshots++;
}
const sample = list.data.candidates.find(c => c.market);
const history = sample ? HistoryResponse.parse(await get(`history/solana/${sample.address}?hours=168`)) : null;
const reviews = ReviewsResponse.parse(await get("research/reviews"));
assert.ok(reviews.data.reports.every(r => r.proposals.every(p => p.activated === false)));
const token = readFileSync(new URL("../discovery/.dev.vars", import.meta.url), "utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
assert.ok(token);
const jobResponse = await fetch(`${base}/admin/jobs`, { headers: { authorization: `Bearer ${token}` } });
assert.equal(jobResponse.status, 200); assert.ok(!(await jobResponse.text()).includes(token));
const dryResponse = await fetch(`${base}/admin/dry-run`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "Local milestone smoke check" }) });
assert.equal(dryResponse.status, 200);
const dry = await dryResponse.json(); assert.equal(dry.launch_enabled, false); assert.equal(await hashJson(dry.inputs), dry.input_hash);
console.log(JSON.stringify({ candidates: list.data.candidates.length, counts: list.data.counts, paired_proofs_replayed: paired, account_snapshots_replayed: accountSnapshots, holder_snapshots_replayed: holderSnapshots, tokens_with_images: list.data.candidates.filter(c => c.market?.image_url).length, history_samples: history?.data.points.length ?? 0, daily_reports: reviews.data.reports.length, admin_unauthorized: 401, authenticated_jobs: 200, election: dry.outcome, launch_enabled: false, source_requests_made_by_this_check: 0 }, null, 2));
