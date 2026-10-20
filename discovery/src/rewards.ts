import { z } from "zod";
import { RewardList, RewardRecord, RewardRequest, RewardSummary } from "./reward-model";
import { evaluateRewards, RewardError } from "./reward-math";
import { hashJson } from "./solana";

type Record = z.infer<typeof RewardRecord>;
const metadata = (r: Record) => ({ id: r.id, created_at: r.created_at, reason: r.reason, request_hash: r.request_hash, input_hash: r.input_hash, result_hash: r.result_hash });
export async function replayRewards(raw: unknown, calculate = true) {
  const r = RewardRecord.parse(raw);
  if (Date.parse(r.inputs.as_of) > Date.parse(r.created_at) || await hashJson({ reason: r.reason, scenario: r.inputs }) !== r.request_hash || await hashJson(r.inputs) !== r.input_hash || await hashJson(r.result) !== r.result_hash || await hashJson(metadata(r)) !== r.record_hash || (calculate && await hashJson(evaluateRewards(r.inputs)) !== r.result_hash)) throw new RewardError("reward_replay_mismatch");
  return r;
}
export async function rewardRecord(db: D1Database, id: string, calculate = true) {
  const row = await db.prepare("SELECT id,created_at,inputs,result,metadata FROM tenx_attention_labs WHERE id=?").bind(z.uuid().parse(id)).first<{ id: string; created_at: string; inputs: string; result: string; metadata: string }>();
  if (!row) return null;
  const r = await replayRewards({ ...JSON.parse(row.metadata), inputs: JSON.parse(row.inputs), result: JSON.parse(row.result) }, calculate);
  if (r.id !== row.id || r.created_at !== row.created_at) throw new RewardError("reward_metadata_mismatch");
  return r;
}
export async function createRewards(db: D1Database, body: unknown, now = new Date()) {
  const request = RewardRequest.parse(body), requestHash = await hashJson({ reason: request.reason, scenario: request.scenario });
  const prior = await rewardRecord(db, request.request_id);
  if (prior) { if (prior.request_hash !== requestHash) throw new RewardError("reward_request_conflict"); return prior; }
  if (Date.parse(request.scenario.as_of) > now.getTime()) throw new RewardError("reward_future_as_of");
  if (new TextEncoder().encode(JSON.stringify(request)).length > 30000) throw new RewardError("reward_input_limit");
  const inputs = request.scenario, result = evaluateRewards(inputs);
  const meta = { id: request.request_id, created_at: now.toISOString(), reason: request.reason, request_hash: requestHash, input_hash: await hashJson(inputs), result_hash: await hashJson(result) };
  const record = RewardRecord.parse({ ...meta, record_hash: await hashJson(meta), inputs, result });
  const inputText = JSON.stringify(inputs), resultText = JSON.stringify(result);
  if (new TextEncoder().encode(inputText + resultText).length > 500000) throw new RewardError("reward_record_limit");
  const day = now.toISOString().slice(0, 10), next = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_attention_labs(id,created_at,inputs,result,metadata) SELECT ?1,?2,?3,?4,?5 WHERE (SELECT COUNT(*) FROM tenx_attention_labs WHERE created_at>=?6 AND created_at<?7)<20").bind(record.id, record.created_at, inputText, resultText, JSON.stringify({ ...meta, record_hash: record.record_hash }), `${day}T00:00:00.000Z`, `${next}T00:00:00.000Z`),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?1,'attention_lab','local-operator',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_attention_labs WHERE id=?5 AND json_extract(metadata,'$.record_hash')=?3)").bind(`attention-lab:${record.id}`, request.reason, record.record_hash, record.created_at, record.id),
  ]);
  const saved = await rewardRecord(db, record.id);
  if (!saved) throw new RewardError("reward_daily_limit");
  if (saved.request_hash !== requestHash) throw new RewardError("reward_request_conflict");
  return saved;
}
export async function rewardList(db: D1Database) {
  const rows = await db.prepare("SELECT id FROM tenx_attention_labs ORDER BY created_at DESC,id LIMIT 5").all<{ id: string }>();
  const runs = [];
  for (const row of rows.results) {
    const r = (await rewardRecord(db, row.id, false))!;
    runs.push(RewardSummary.parse({ id: r.id, created_at: r.created_at, result_hash: r.result_hash, record_hash: r.record_hash, result: { ...r.result, campaigns: r.result.campaigns.map(c => ({ ...c, periods: c.periods.map(({ participants: _private, ...period }) => period) })) } }));
  }
  return RewardList.parse({ scope: "local_hypothetical_attention_lab", runs });
}
