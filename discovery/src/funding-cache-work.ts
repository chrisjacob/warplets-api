import { analyzeWalletEvidence, type WalletEvidence } from "./wallet-analysis";
import { fundingRows, fundingTask, FundingScanSchema, loadFundingCheckpoints, recoverCachedFunding, type FundingScan } from "./funding-history";
import { directFundingLimit, expandedFundingScope, fundingSecondHopScope } from "./wallet-funding-scope";
import { hashJson } from "./solana";
import { keys, WalletTransactionSchema } from "./wallet-rpc";
import { validWalletTransaction } from "./wallet-trades";
import { WalletWorkSchema, type WalletWork } from "./wallet-work-model";
import { fundingSourceLimited } from "./priority";
import type { Candidate } from "./model";
import { priorWalletEvidence } from "./wallet-work";

type Record = WalletEvidence["records"][number];
export class FundingCacheCapacityError extends Error {
  constructor() { super("wallet_snapshot_sample_bound"); }
}

// Read-only, bounded projection. No RPC client or provider transport exists on
// this path. It never publishes a new wallet observation or alters old evidence.
export async function projectCachedFunding(db: D1Database, prior: WalletEvidence, original: FundingScan[], now: Date) {
  const pending = new Set(original.flatMap(scan => fundingTask(scan).pending.map(row => row.signature)));
  if (prior.gaps.some(g => ["funding_wallet_limit", "funding_output_limit", "wallet_transaction_sample_limit"].includes(g)) ||
      prior.records.length + [...pending].filter(sig => !prior.records.some(r => r.signature === sig)).length > 64) throw new FundingCacheCapacityError();
  const recovery = await recoverCachedFunding(db, original, now, directFundingLimit(prior));
  const scans = recovery.scans, records = structuredClone(prior.records);
  let bytes = records.reduce((n, r) => n + new TextEncoder().encode(JSON.stringify(r.transaction)).length, 0);
  if (bytes > 900000) throw new FundingCacheCapacityError();
  const saved = new Map<string, Record | null>();
  const store = (record: Record) => {
    const index = records.findIndex(r => r.signature === record.signature);
    const previous = index < 0 ? null : records[index]!;
    const nextBytes = bytes - (previous ? new TextEncoder().encode(JSON.stringify(previous.transaction)).length : 0) + new TextEncoder().encode(JSON.stringify(record.transaction)).length;
    if (nextBytes > 900000 || index < 0 && records.length >= 64) throw new FundingCacheCapacityError();
    bytes = nextBytes;
    const next = { ...record, purposes: previous?.purposes ?? record.purposes };
    if (index < 0) records.push(next); else records[index] = next;
  };
  for (const record of recovery.records) store({ ...record, purposes: ["wallet"] });
  async function body(signature: string): Promise<Record | null> {
    const existing = records.find(r => r.signature === signature && r.status === "available");
    if (existing) return existing;
    if (!saved.has(signature)) {
      const row = await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{payload:string;payload_hash:string;fetched_at:string}>();
      if (!row) saved.set(signature, null);
      else {
        if (new TextEncoder().encode(row.payload).length > 250000) throw new Error("wallet_transaction_too_large");
        const transaction = WalletTransactionSchema.parse(JSON.parse(row.payload));
        if (await hashJson(transaction) !== row.payload_hash) throw new Error("wallet_cache_hash_or_identity_mismatch");
        saved.set(signature, { signature, transaction, fetched_at: row.fetched_at, status: "available", purposes: ["wallet"] });
      }
    }
    return saved.get(signature) ?? null;
  }
  function validate(scan: FundingScan, signature: string, record: Record) {
    const row = fundingRows(scan).find(r => r.signature === signature), tx = record.transaction;
    if (!row || !tx || tx.transaction.signatures[0] !== signature || tx.slot !== row.slot) throw new Error("wallet_cache_hash_or_identity_mismatch");
    if (new TextEncoder().encode(JSON.stringify(tx)).length > 250000) throw new Error("wallet_transaction_too_large");
    validWalletTransaction(tx);
    if (!keys(tx).includes(scan.wallet)) throw new Error("funding_wallet_not_referenced");
    if (!Number.isFinite(Date.parse(record.fetched_at)) || Date.parse(record.fetched_at) > now.getTime() || row.blockTime === null || tx.blockTime !== row.blockTime || tx.blockTime * 1000 > now.getTime()) throw new Error("wallet_cache_time_mismatch");
  }
  // Revalidate all claimed available bodies before admitting any progress.
  for (const scan of scans) for (const entry of scan.examined.filter(e => e.status === "available")) {
    const record = await body(entry.signature);
    if (!record) throw new Error("wallet_checkpoint_body_missing");
    validate(scan, entry.signature, record); store(record);
  }
  let probes = 0, windows = 0, added = 0;
  const missing = new Set<string>();
  for (const scan of scans) {
    const task = fundingTask(scan);
    if (task.blocked || windows >= 3) continue;
    let consumed = 0;
    for (const row of task.pending) {
      if (consumed >= 3 || probes >= 32) break;
      probes++;
      const record = await body(row.signature);
      if (!record) {
        // A retained terminal observation is not permission to buy that body
        // again. Only genuinely unread references add to the RPC lower bound.
        if (!prior.records.some(r => r.signature === row.signature)) missing.add(row.signature);
        continue;
      }
      validate(scan, row.signature, record); store(record);
      scan.examined.push({ signature: row.signature, status: "available" });
      consumed++; added++;
    }
    if (consumed) windows++;
  }
  await analyzeWalletEvidence({ ...prior, observed_at: now.toISOString(), records, funding_scans: scans, second_hop_scans: await fundingSecondHopScope(db, prior, records, scans) });
  const changes = [];
  for (const [index, scan] of scans.entries()) if (await hashJson(scan) !== await hashJson(original[index]!)) changes.push({ before: original[index]!, after: scan });
  return { scans, changes, recovered: recovery.recovered.length, added, known_missing: missing.size };
}

// Each exact checkpoint uses compare-and-swap plus current candidate/lease
// guards. Independently valid earlier advances survive an interrupted turn.
export async function continueCachedFunding(db: D1Database, candidate: Candidate, owner: string, now: Date) {
  const retained = await priorWalletEvidence(db, candidate);
  if (!retained?.funding_scans?.length || !candidate.wallet_analysis) throw new Error("funding_continuation_unavailable");
  const prior = await expandedFundingScope(db, retained);
  const original = await loadFundingCheckpoints(db, candidate.address, prior.funding_scans!.map(s => s.anchor), false, directFundingLimit(prior));
  const projection = await projectCachedFunding(db, prior, original, now);
  for (const change of projection.changes) {
    const at = new Date().toISOString();
    const normalized = FundingScanSchema.parse({ ...change.after, attempted_at: at });
    const result = await db.prepare(`UPDATE tenx_funding_scans SET payload=?1,payload_hash=?2,attempted_at=?3
      WHERE address=?4 AND wallet=?5 AND anchor_signature=?6 AND payload_hash=?7
      AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?4 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?8)
      AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?9 AND lease_until>?3)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`)
      .bind(JSON.stringify(normalized), await hashJson(normalized), at, candidate.address, normalized.wallet, normalized.anchor.signature, await hashJson(change.before), candidate.wallet_analysis.evidence_hash, owner).run();
    if (result.meta.changes !== 1) throw new Error("funding_cache_checkpoint_or_owner_changed");
  }
  const tasks = projection.scans.map(fundingTask), gaps = [...new Set(tasks.flatMap(t => t.gaps))];
  const complete = tasks.filter(t => t.coverage.status === "window_examined").length;
  return WalletWorkSchema.parse({ address: candidate.address, symbol: candidate.symbol, source_evidence_hash: candidate.wallet_analysis.evidence_hash,
    snapshot_at: candidate.wallet_analysis.observed_at, attempted_at: now.toISOString(), stage: complete === tasks.length ? "refresh_required" : fundingSourceLimited(gaps) ? "source_limited" : "direct_funding",
    windows: tasks.length, examined_windows: complete, pending_transactions: tasks.reduce((n, t) => n + t.coverage.transactions_in_window - t.coverage.transactions_examined, 0),
    decoded_transactions: tasks.reduce((n, t) => n + t.coverage.transactions_examined, 0), rpc_calls: 0, gaps });
}

export async function recordCachedFundingWork(db: D1Database, candidate: Candidate, owner: string, started: string, progress: WalletWork, completed: number) {
  const at = new Date().toISOString(), next = new Date(Date.parse(at) + 60000).toISOString();
  const guard = `EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2)
    AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?3 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?4)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`;
  const source = candidate.wallet_analysis!.evidence_hash;
  const result = await db.batch([
    db.prepare(`INSERT INTO tenx_wallet_work(address,source_evidence_hash,payload,attempted_at) SELECT ?3,?4,?5,?2 WHERE ${guard}
      ON CONFLICT(address) DO UPDATE SET source_evidence_hash=excluded.source_evidence_hash,payload=excluded.payload,attempted_at=excluded.attempted_at`).bind(owner, at, candidate.address, source, JSON.stringify(progress)),
    db.prepare(`INSERT INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code)
      SELECT ?1,?3,?4,'funding','succeeded',?5,?2,0,?6,0,NULL WHERE ${guard}`).bind(owner, at, candidate.address, source, started, completed),
    db.prepare(`INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) SELECT ?3,?5,?6 WHERE ${guard}
      ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at`).bind(owner, at, candidate.address, source, started, next),
    db.prepare(`UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_address=?3,next_refresh_at=?5 WHERE id=1 AND ${guard}`).bind(owner, at, candidate.address, source, next),
  ]);
  return result[0]!.meta.changes === 1 && result[3]!.meta.changes === 1;
}
