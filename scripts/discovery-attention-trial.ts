import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, fsyncSync, closeSync, openSync, writeSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sqliteD1 } from "../app/functions/_lib/sqliteTestDb";
import { readAttentionQueue } from "../discovery/src/attention-queue";
import { CandidateSchema } from "../discovery/src/model";
import { scoreFirstMarkets, scoreIntegrityPriceInputs } from "../discovery/src/discovery-score-store";
import { defaultScoreInputV4, freezeDiscoveryScoreV4 } from "../discovery/src/discovery-score-v4";
import { ATTENTION_TRIAL_POLICY as P, trialStudy, verifyTrialStudy, trialSlot, planAttentionTrial, freezeAttentionTrial, freezeTrialLabels, trialCohortResults,
  type TrialStudy, type TrialPlan, type TrialDeepRow, type TrialLabelsRecord } from "../discovery/src/attention-selection-trial";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const sources = ["scripts/discovery-attention-trial.ts", "discovery/src/attention-selection-trial.ts", "discovery/src/attention-lightweight.ts", "discovery/src/attention-queue.ts", "discovery/src/attention-feed-contract.ts",
  "discovery/src/model.ts", "discovery/src/attention-queue-model.ts", "discovery/src/discovery-score.ts", "discovery/src/discovery-score-model.ts", "discovery/src/discovery-score-v2.ts", "discovery/src/discovery-score-v2-model.ts", "discovery/src/discovery-score-v3.ts", "discovery/src/discovery-score-v3-model.ts", "discovery/src/discovery-score-v4.ts", "discovery/src/discovery-score-v4-model.ts", "discovery/src/discovery-score-store.ts"];
const codeHashes = () => Object.fromEntries(sources.map(p => [p, sha(readFileSync(new URL("../" + p, import.meta.url)))]));
function directory(value: string, create = false) {
  const root = realpathSync(new URL("../.tmp", import.meta.url)), target = path.resolve(value), parent = realpathSync(path.dirname(target)), relative = path.relative(root, parent);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || create && existsSync(target)) throw Error("trial_private_directory_required");
  if (create) mkdirSync(target, { mode: 0o700 });
  if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory() || realpathSync(target) !== path.join(parent, path.basename(target))) throw Error("trial_private_directory_required");
  return target;
}
function write(file: string, value: unknown) {
  const b = Buffer.from(JSON.stringify(value) + "\n"), fd = openSync(file, "wx", 0o600);
  try { let offset = 0; while (offset < b.length) offset += writeSync(fd, b, offset); fsyncSync(fd); } finally { closeSync(fd); }
  return sha(b);
}
function read(file: string, max = 3000000): any {
  const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw Error("trial_regular_bounded_file_required");
  return JSON.parse(readFileSync(file, "utf8"));
}
async function studyAt(output: string) {
  const root = directory(output), saved = read(path.join(root, "study.json"), 32000);
  await verifyTrialStudy(saved.study);
  if (JSON.stringify(saved.code_hashes) !== JSON.stringify(codeHashes())) throw Error("trial_implementation_changed_new_study_required");
  if (Date.parse(saved.study.start) > Date.now()) throw Error("trial_study_future");
  return { root, study: saved.study as TrialStudy };
}
export async function initAttentionTrial(output: string) {
  const root = directory(output, true), study = await trialStudy(new Date().toISOString());
  write(path.join(root, "study.json"), { study, code_hashes: codeHashes() });
  return { root, study_hash: study.study_hash, start: study.start, provider_requests: 0, launch_gates_changed: false };
}
async function sourceAt(root: string, study: TrialStudy, slot: number) {
  const previous: string[] = []; let result: TrialPlan | null = null;
  for (let n = 0; n <= slot; n++) {
    const file = path.join(root, `day-${n}`, "source.json"); if (!existsSync(file)) { if (n === slot) throw Error("trial_original_source_missing"); continue; }
    directory(path.dirname(file)); const saved = read(file, 1500000);
    const replay = await planAttentionTrial(study, saved.queue, [...new Set(previous)], n);
    if (JSON.stringify(replay) !== JSON.stringify(saved)) throw Error("trial_source_replay_mismatch");
    previous.push(...replay.plan.population.map(p => p.address)); result = replay;
  }
  if (!result || result.plan.slot !== slot) throw Error("trial_original_source_missing"); return result;
}
async function cohortAt(root: string, study: TrialStudy, slot: number) {
  const source = await sourceAt(root, study, slot), folder = directory(path.join(root, `day-${slot}`)), deep = read(path.join(folder, "deep.json"), P.deep_bytes_max);
  const cohort = await freezeAttentionTrial(source, deep);
  if (JSON.stringify(cohort) !== JSON.stringify(read(path.join(folder, "cohort.json")))) throw Error("trial_cohort_replay_mismatch");
  return { source, cohort, folder };
}
function openDatabase(database: string) {
  if (!lstatSync(database).isFile() || lstatSync(database).isSymbolicLink()) throw Error("trial_regular_database_required");
  const sql = new DatabaseSync(database, { readOnly: true }); sql.exec("PRAGMA query_only=ON;PRAGMA busy_timeout=10000;BEGIN"); return sql;
}
async function cachedDeep(sql: DatabaseSync, source: TrialPlan): Promise<TrialDeepRow[]> {
  const db = sqliteD1(sql), wanted = source.plan.population.filter(p => source.plan.slot < 3 || p.first_enrollment).map(p => p.address);
  const rows = sql.prepare(`WITH wanted AS (SELECT value address,CAST(key AS INTEGER) position FROM json_each(?)), scoped AS (
    SELECT w.address,w.position,length(CAST(c.payload AS BLOB)) bytes,c.payload FROM wanted w LEFT JOIN tenx_candidates c ON c.address=w.address AND c.mode='live'),
    bounded AS (SELECT *,SUM(COALESCE(bytes,0)) OVER(ORDER BY position) total FROM scoped)
    SELECT address,bytes,CASE WHEN bytes<=1600000 AND total<=2000000 THEN payload ELSE NULL END payload FROM bounded ORDER BY position LIMIT 100`).all(JSON.stringify(wanted));
  const candidates = new Map<string, ReturnType<typeof CandidateSchema.parse>>(), gaps = new Map<string, string>();
  for (const row of rows) {
    const address = String(row.address);
    if (!row.payload) { gaps.set(address, row.bytes === null ? "outside_saved_candidate_inventory" : "cached_input_byte_bound"); continue; }
    try {
      const c = CandidateSchema.parse(JSON.parse(String(row.payload)));
      const dates = [c.checked_at, c.first_seen_at, c.risk.observed_at, c.creation?.block_time, c.creation?.fetched_at, c.graduation?.block_time, c.graduation?.fetched_at, c.market?.fetched_at, c.market?.observed_at, c.holders?.observed_at, c.wallet_analysis?.observed_at];
      if (c.address !== address || c.mode !== "live" || dates.some(t => t && t > source.plan.cutoff)) throw Error("candidate_cutoff");
      candidates.set(address, c);
    } catch { gaps.set(address, "cached_candidate_unusable_or_future"); }
  }
  const at = new Date(source.plan.cutoff), prices = await scoreIntegrityPriceInputs(db, [...candidates.keys()], at), first = await scoreFirstMarkets(db, [...candidates.keys()], at);
  const result: TrialDeepRow[] = [];
  for (const p of source.plan.population) {
    const c = candidates.get(p.address); let row: TrialDeepRow = { address: p.address, scorecard: null, gap: gaps.get(p.address) ?? "repeat_outside_holdout_arm" };
    if (c) try {
      const history = prices.get(p.address), scorecard = await freezeDiscoveryScoreV4(defaultScoreInputV4(c, at, history?.prices ?? [], history?.history_limited ?? false, first.get(p.address) ?? null));
      const next = { address: p.address, scorecard, gap: null };
      row = Buffer.byteLength(JSON.stringify([...result, next])) < P.deep_bytes_max - 20000 ? next : { ...row, gap: "frozen_score_byte_bound" };
    } catch { row.gap = "cached_score_inputs_unusable"; }
    result.push(row);
  }
  return result;
}
export async function captureAttentionTrial(output: string, database: string) {
  const { root, study } = await studyAt(output), at = new Date(), slot = trialSlot(study, at), folder = directory(path.join(root, `day-${slot}`), true);
  // An uncertain/failed original capture remains spent; never reuse this folder.
  write(path.join(folder, "attempt.json"), { study_hash: study.study_hash, slot, started_at: at.toISOString() });
  const previous: string[] = [];
  for (let n = 0; n < slot; n++) if (existsSync(path.join(root, `day-${n}`, "source.json"))) previous.push(...(await sourceAt(root, study, n)).plan.population.map(p => p.address));
  const sql = openDatabase(database);
  try {
    const source = await planAttentionTrial(study, await readAttentionQueue(sqliteD1(sql), at), [...new Set(previous)], slot);
    write(path.join(folder, "source.json"), source); // precedes any deep reads
    const deep = await cachedDeep(sql, source), cohort = await freezeAttentionTrial(source, deep);
    write(path.join(folder, "deep.json"), deep); write(path.join(folder, "cohort.json"), cohort);
    write(path.join(folder, "blind-review.json"), { cohort_hash: cohort.cohort_hash, instructions: "Judge meme relevance and whether it deserves founder review. Do not inspect arm allocations/scores before submitting baseline labels. Labels are personal assessments, not fraud proof.",
      rows: cohort.blind.map(b => { const r = source.queue.rows.find(r => r.chain === "solana" && r.address === b.address)!; return { ...b, name: r.name, symbol: r.symbol, liquidity_usd: r.liquidity_usd, market_cap_usd: r.market_cap_usd }; }) });
    write(path.join(folder, "baseline-template.json"), { cohort_hash: cohort.cohort_hash, phase: "baseline", rows: cohort.blind.map(b => ({ id: b.id, worthwhile: "unknown", adverse: "unknown", minutes: 0, note: "" })) });
    if (sql.prepare("SELECT total_changes() n").get()!.n !== 0) throw Error("trial_source_written");
    return { slot, cohort_hash: cohort.cohort_hash, population: source.plan.population.length, blind_reviews: cohort.blind.length,
      arm_slots: Object.fromEntries(Object.entries(cohort.arms).map(([arm, members]) => [arm, members.length])), baseline_due: new Date(at.getTime() + 7200000).toISOString(), provider_requests: 0, database_writes: 0 };
  } finally { if (sql.isTransaction) sql.exec("ROLLBACK"); sql.close(); }
}
export async function followupAttentionTrial(output: string, slot: number, database: string) {
  const { root, study } = await studyAt(output), { cohort, folder } = await cohortAt(root, study, slot), at = new Date(), age = at.getTime() - Date.parse(cohort.cutoff);
  if (age < 86400000 || age > 172800000) throw Error("trial_followup_window");
  write(path.join(folder, "followup-attempt.json"), { started_at: at.toISOString(), cohort_hash: cohort.cohort_hash });
  const sql = openDatabase(database);
  try {
    const queue = await readAttentionQueue(sqliteD1(sql), at);
    if (Buffer.byteLength(JSON.stringify(queue)) > P.source_bytes_max) throw Error("trial_followup_bytes");
    write(path.join(folder, "followup.json"), queue);
    write(path.join(folder, "followup-template.json"), { cohort_hash: cohort.cohort_hash, phase: "followup", rows: cohort.blind.map(b => ({ id: b.id, worthwhile: "unknown", adverse: "unknown", minutes: 0, note: "" })) });
    return { slot, cutoff: queue.as_of, presence: cohort.blind.map(b => ({ ...b, state: queue.rows.some(r => r.chain === "solana" && r.address === b.address && r.attention_families > 0) ? "observed_in_fresh_bounded_view" : "not_observed_fresh_unknown" })), provider_requests: 0, database_writes: 0 };
  } finally { if (sql.isTransaction) sql.exec("ROLLBACK"); sql.close(); }
}
export async function reviewAttentionTrial(output: string, slot: number, labelsFile: string) {
  const { root, study } = await studyAt(output), { cohort, folder } = await cohortAt(root, study, slot);
  const record = await freezeTrialLabels(cohort, read(labelsFile, 32000), new Date().toISOString()), phase = record.labels.phase;
  const observation_hash = phase === "baseline" ? cohort.cohort_hash : sha(readFileSync(path.join(folder, "followup.json")));
  if (phase === "followup" && !existsSync(path.join(folder, "baseline-labels.json"))) throw Error("trial_baseline_missing");
  const label_file_hash = write(path.join(folder, `${phase}-labels.json`), { record, observation_hash });
  return { slot, phase, label_file_hash, provider_requests: 0 };
}
async function labelsAt(folder: string, cohort: Awaited<ReturnType<typeof freezeAttentionTrial>>, phase: "baseline" | "followup"): Promise<TrialLabelsRecord | null> {
  const file = path.join(folder, `${phase}-labels.json`); if (!existsSync(file)) return null;
  const saved = read(file, 40000), replay = await freezeTrialLabels(cohort, saved.record.labels, saved.record.recorded_at);
  const observation_hash = phase === "baseline" ? cohort.cohort_hash : sha(readFileSync(path.join(folder, "followup.json")));
  if (JSON.stringify(replay) !== JSON.stringify(saved.record) || saved.observation_hash !== observation_hash || replay.recorded_at > new Date().toISOString()) throw Error("trial_labels_replay_mismatch"); return replay;
}
export async function reportAttentionTrial(output: string) {
  const { root, study } = await studyAt(output), at = new Date(), days = [], primaryIdentities = new Set<string>(), reviewedIdentities = new Set<string>();
  const totals = Object.fromEntries(P.arms.map(arm => [arm, { cohorts: 0, slots: 0, filled: 0, retained_worthwhile: 0, unknown: 0, adverse: 0, reviewed_minutes: 0 }]));
  for (let slot = 0; slot < 14; slot++) {
    const start = Date.parse(study.start) + slot * 86400000, folder = path.join(root, `day-${slot}`);
    if (!existsSync(folder)) { days.push({ slot, state: at.getTime() < start ? "future" : at.getTime() <= start + 7200000 ? "capture_window_open" : "missed_original_slot" }); continue; }
    directory(folder);
    if (!existsSync(path.join(folder, "cohort.json"))) { days.push({ slot, state: "original_capture_incomplete_spent" }); continue; }
    const { source, cohort } = await cohortAt(root, study, slot), baseline = await labelsAt(folder, cohort, "baseline"), followup = await labelsAt(folder, cohort, "followup");
    const results = trialCohortResults(cohort, baseline, followup);
    if (slot >= 3) {
      cohort.blind.filter(b => Object.values(cohort.arms).some(addresses => addresses.includes(b.address))).forEach(b => {
        primaryIdentities.add(b.address);
        const a = baseline?.labels.rows.find(r => r.id === b.id), f = followup?.labels.rows.find(r => r.id === b.id);
        if (a && f && a.worthwhile !== "unknown" && f.worthwhile !== "unknown") reviewedIdentities.add(b.address);
      });
      for (const arm of P.arms) {
        const t = totals[arm], r = results[arm]; t.cohorts++;
        for (const k of ["slots", "filled", "retained_worthwhile", "unknown", "adverse", "reviewed_minutes"] as const) t[k] += r[k];
      }
    }
    const controls = cohort.controls.map(address => { const id = cohort.blind.find(b => b.address === address)!.id; return { address, baseline: baseline?.labels.rows.find(r => r.id === id)?.worthwhile ?? "missing", followup: followup?.labels.rows.find(r => r.id === id)?.worthwhile ?? "missing" }; });
    const age = at.getTime() - Date.parse(cohort.cutoff);
    days.push({ slot, state: followup ? "followup_reported" : !baseline ? age > 7200000 ? "baseline_window_missed" : "baseline_labels_missing" : age > 172800000 ? "followup_window_missed" : "awaiting_followup", holdout: slot >= 3, population: source.plan.population.length,
      repeated: source.plan.population.filter(p => !p.first_enrollment).length, results, controls, acquisition_cost: cohort.cost });
  }
  return { version: "attention-trial-report-v1", study_hash: study.study_hash, at: at.toISOString(), policy: study.policy, days,
    holdout_enrolled_review_identities: primaryIdentities.size, holdout_completed_review_identities: reviewedIdentities.size, holdout_totals: totals,
    missing_outcome_bounds_per_five: Object.fromEntries(P.arms.map(arm => { const t = totals[arm]; return [arm, { lower: t.cohorts ? t.retained_worthwhile / t.cohorts : null, upper: t.cohorts ? (t.retained_worthwhile + t.unknown) / t.cohorts : null }]; })),
    assessment: "descriptive_only_selection_uplift_not_yet_demonstrated", cost_gap: "original_deep_evidence_acquisition_cost_unknown",
    automatic_promotion: false, launch_gates_changed: false, scoring_effect: "none", provider_requests: 0, database_writes: 0 };
}
async function main(args: string[]) {
  const [command, root, a, b] = args;
  if (command === "init" && root && args.length === 2) return initAttentionTrial(root);
  if (command === "capture" && root && a && args.length === 3) return captureAttentionTrial(root, a);
  if (command === "report" && root && args.length === 2) return reportAttentionTrial(root);
  if ((command === "review" || command === "followup") && root && a && b && /^(?:[0-9]|1[0-3])$/.test(a) && args.length === 4) return command === "review" ? reviewAttentionTrial(root, Number(a), b) : followupAttentionTrial(root, Number(a), b);
  throw Error("Use init ROOT | capture ROOT DATABASE | review ROOT DAY LABELS | followup ROOT DAY DATABASE | report ROOT");
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) void main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(() => { console.error("Attention trial held. Original study/slots remain intact; no collection, retry or launch action was performed."); process.exitCode = 1; });
