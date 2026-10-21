import { z } from "zod";
import { DEFAULT_POLICY, CandidateSchema, PolicySchema, type Policy } from "./model";
import { evaluateElection, freezeElection } from "./elections";
import { POLICY_FIELDS, PolicyPreviewInputSchema, PolicyPreviewRecordSchema, PolicyPreviewResultSchema, PreviewRequestSchema, PublicPolicySchema } from "./policy-model";
import { hashJson } from "./solana";
import { NEW_TOKEN_CAP_REVIEW_USD } from "./market-review";
import { PRICE_PATTERN_RULE } from "./price-pattern";
import {DISCOVERY_SCORE_POLICY_V3} from "./discovery-score-v3-model";

export class PolicyPreviewError extends Error {}
export async function publicPolicy() {
  return PublicPolicySchema.parse({ policy: DEFAULT_POLICY, policy_hash: await hashJson(DEFAULT_POLICY), status: "proposed_local_policy", approved_by: null, activation_enabled: false,
    display_score: "Discovery score descending, effective evidence coverage descending, fresh liquidity descending, creation time ascending, then address ASCII. Observed tokens can rank before passing every action check. The unchanged election rehearsal engine still uses eligible liquidity ordering; this display score never overrides voting or launch gates.",
    discovery_scoring:{policy:DISCOVERY_SCORE_POLICY_V3,policy_hash:await hashJson(DISCOVERY_SCORE_POLICY_V3)},
    diagnostics: [
      { name: "High reported cap for a new token", rule: `Reported cap above $${NEW_TOKEN_CAP_REVIEW_USD.toLocaleString("en-US")} within 24 hours of verified creation.`, classification: "review_only" },
      { name: "Unusually smooth price rise", rule: `${PRICE_PATTERN_RULE.version}: ≥${PRICE_PATTERN_RULE.min_samples} prices over ≥60 minutes; return ≥5%; upward steps ≥90%; sampled drawdown ≤1%; linear R² ≥0.98.`, classification: "review_only" },
      { name: "Fees, bundles and wallet associations", rule: "Inspect bounded transaction, fee, funding and outcome evidence. Fees do not prove organic trading; associations do not establish common control or fraud.", classification: "review_only" },
    ], gaps: ["Free source coverage is incomplete; ten eligible tokens are not guaranteed.", "Market cap and liquidity are provider reports, not an independent supply/depth audit.", "LP locks, beneficial ownership and organic trading remain unverified.", "No production policy approval, live voting, launches, rewards or spending authority."],
  });
}
// Only tighter numeric thresholds may be compared. Age, freshness, proof,
// holder and wallet requirements stay locked, including in hypothetical previews.
export function assertTighterPolicy(proposed: Policy, baseline: Policy) {
  const editable = new Set<string>(POLICY_FIELDS.map(f => f.key));
  for (const key of Object.keys(baseline) as (keyof Policy)[]) if (!editable.has(key) && proposed[key] !== baseline[key]) throw new PolicyPreviewError("policy_evidence_gates_locked");
  for (const f of POLICY_FIELDS) if (f.direction === "minimum" ? proposed[f.key] < baseline[f.key] : proposed[f.key] > baseline[f.key]) throw new PolicyPreviewError("policy_preview_cannot_relax_thresholds");
}
export function evaluatePolicyPreview(raw: z.infer<typeof PolicyPreviewInputSchema>) {
  const inputs = PolicyPreviewInputSchema.parse(raw);
  assertTighterPolicy(inputs.proposed_policy, inputs.baseline.policy);
  const baseline = evaluateElection(inputs.baseline), proposed = evaluateElection({ ...inputs.baseline, policy: inputs.proposed_policy });
  const byAddress = new Map(baseline.candidates.map(c => [c.address, c]));
  const changed = proposed.candidates.flatMap(c => {
    const b = byAddress.get(c.address)!;
    const added = c.reasons.filter(r => !b.reasons.includes(r)), removed = b.reasons.filter(r => !c.reasons.includes(r));
    return c.eligibility === b.eligibility && !added.length && !removed.length ? [] : [{ address: c.address, symbol: c.symbol, before: b.eligibility, after: c.eligibility, added_reasons: added, removed_reasons: removed }];
  });
  return PolicyPreviewResultSchema.parse({ baseline, proposed, changed, activated: false, provider_requests: 0 });
}
type Record = z.infer<typeof PolicyPreviewRecordSchema>;
const metadata = (r: Record) => ({ id: r.id, created_at: r.created_at, reason: r.reason, request_hash: r.request_hash, input_hash: r.input_hash, result_hash: r.result_hash });
export async function replayPolicyPreview(raw: Record) {
  const r = PolicyPreviewRecordSchema.parse(raw);
  // Request hashes use normalized resulting policy, so unchanged form fields
  // and sparse edits have the same retry identity.
  if (r.created_at !== r.inputs.baseline.as_of || await hashJson({ reason: r.reason, policy: r.inputs.proposed_policy }) !== r.request_hash || await hashJson(r.inputs) !== r.input_hash || await hashJson(r.result) !== r.result_hash || await hashJson(metadata(r)) !== r.record_hash || await hashJson(evaluatePolicyPreview(r.inputs)) !== r.result_hash) throw new PolicyPreviewError("policy_preview_replay_mismatch");
  return r;
}
export async function policyPreviewRecord(db: D1Database, id: string) {
  const row = await db.prepare("SELECT created_at,inputs,result,metadata FROM tenx_policy_previews WHERE id=?1").bind(z.uuid().parse(id)).first<{ created_at: string; inputs: string; result: string; metadata: string }>();
  if (!row) return null;
  const record = await replayPolicyPreview({ ...JSON.parse(row.metadata), inputs: JSON.parse(row.inputs), result: JSON.parse(row.result) });
  if (record.id !== id || record.created_at !== row.created_at) throw new PolicyPreviewError("policy_preview_metadata_mismatch");
  return record;
}
export async function createPolicyPreview(db: D1Database, body: unknown, observedAt?: Date) {
  const request = PreviewRequestSchema.parse(body), proposed = PolicySchema.parse({ ...DEFAULT_POLICY, ...request.edits });
  assertTighterPolicy(proposed, DEFAULT_POLICY);
  const requestHash = await hashJson({ reason: request.reason, policy: proposed });
  const prior = await policyPreviewRecord(db, request.request_id);
  if (prior) { if (prior.request_hash !== requestHash) throw new PolicyPreviewError("policy_preview_request_conflict"); return prior; }
  const rows = await db.prepare(`SELECT CASE WHEN COUNT(*) OVER()>500 OR SUM(length(CAST(payload AS BLOB))) OVER()>1600000 THEN NULL ELSE payload END AS payload FROM tenx_active_candidates WHERE mode='live' ORDER BY address LIMIT 501`).all<{ payload: string | null }>();
  if (rows.results.length > 500 || rows.results.some(r => r.payload === null)) throw new PolicyPreviewError("policy_preview_inventory_limit");
  // Timestamp after the single inventory read, so concurrent refreshes already
  // present in that read cannot accidentally be labelled future evidence.
  const now = observedAt ?? new Date();
  const inputs = PolicyPreviewInputSchema.parse({ version: "policy-preview-v1", baseline: freezeElection(rows.results.map(r => CandidateSchema.parse(JSON.parse(r.payload!))), now), proposed_policy: proposed });
  const result = evaluatePolicyPreview(inputs), meta = { id: request.request_id, created_at: now.toISOString(), reason: request.reason, request_hash: requestHash, input_hash: await hashJson(inputs), result_hash: await hashJson(result) };
  const record = PolicyPreviewRecordSchema.parse({ ...meta, record_hash: await hashJson(meta), inputs, result });
  const inputText = JSON.stringify(inputs), resultText = JSON.stringify(result);
  const inputBytes = new TextEncoder().encode(inputText).length, resultBytes = new TextEncoder().encode(resultText).length;
  // Baseline plus proposed results cover the entire inventory, unlike a single
  // election result. Bound the combined row below D1's row size, with metadata
  // headroom; do not truncate tokens simply to fit the old single-result cap.
  if (inputBytes > 1_600_000 || resultBytes > 800_000 || inputBytes + resultBytes > 1_900_000) throw new PolicyPreviewError("policy_preview_inventory_limit");
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_policy_previews(id,created_at,inputs,result,metadata) SELECT ?1,?2,?3,?4,?5 WHERE (SELECT COUNT(*) FROM tenx_policy_previews WHERE created_at>=?6 AND created_at<?7)<20").bind(record.id, record.created_at, inputText, resultText, JSON.stringify({ ...meta, record_hash: record.record_hash }), `${now.toISOString().slice(0, 10)}T00:00:00.000Z`, `${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00.000Z`),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'policy_preview','local-operator',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_policy_previews WHERE id=?5 AND json_extract(metadata,'$.record_hash')=?3)").bind(`policy-preview:${record.id}`, request.reason, record.record_hash, record.created_at, record.id),
  ]);
  const saved = await policyPreviewRecord(db, record.id);
  if (!saved) throw new PolicyPreviewError("policy_preview_daily_limit");
  if (saved.request_hash !== requestHash) throw new PolicyPreviewError("policy_preview_request_conflict");
  return saved;
}
