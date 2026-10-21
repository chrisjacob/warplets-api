import { Address, CandidateSchema, DEFAULT_POLICY, shortlist, type Candidate } from "./model";
import { analyzeWalletEvidence, WalletEvidenceSchema, type WalletEvidence } from "./wallet-analysis";
import { creationRoles, verifiedTrades } from "./wallet-trades";
import { walletTransaction, WalletTransactionSchema } from "./wallet-rpc";
import { candidates, captureCohort, control, reserveQuota } from "./store";
import { MAINNET_GENESIS, RpcClient, SourceError, SignatureRows, persistRpcBackoff, type SignatureRow } from "./rpc";
import { curveAddress } from "./pump";
import { hashJson } from "./solana";
import { HolderEvidenceSchema } from "./holders";
import { ReviewSchema } from "./research-model";
import type { Settings } from "./ingest";
import { collectFundingHistories, type FundingAnchor } from "./funding-history";
import { buildSecondHopOutflows, secondHopAnchors } from "./second-hop";
import { comparePotential, potential } from "./priority";
import { catchupLimit, continueFunding, priorWalletEvidence, walletWork } from "./wallet-work";
import { compareWalletPlans, walletPlan } from "./wallet-plan";
import type { WalletPlan } from "./wallet-plan-model";
import { recordUnsupportedFundingRead, recoverFundingBodies } from "./funding-recovery";
import {currentWalletReader,DIRECT_FUNDING_WALLETS} from "./wallet-funding-scope";
import { continueCachedFunding, recordCachedFundingWork } from "./funding-cache-work";
import {d1EvidenceReadStore,type EvidenceReadStore} from "./evidence-read-store";
import {d1EvidenceWriteStore} from "./evidence-write-store";

export type WalletSettings = Settings & { walletEnabled: boolean; walletDailyLimit: number };
export async function walletHolderInputFromStore(store:EvidenceReadStore,candidate:Candidate):Promise<WalletEvidence["holders"]>{
  if(!candidate.holders?.payload_hash)return null;
  const saved=await store.holderReceipt(candidate.holders.payload_hash);
  return saved?{analysis:candidate.holders,evidence:HolderEvidenceSchema.parse(JSON.parse(saved.payload))}:null;
}
export async function walletStatus(db: D1Database, limit: number, enabled: boolean) {
  const state = await db.prepare("SELECT * FROM tenx_wallet_control WHERE id=1").first();
  const usage = await db.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?1").bind(new Date().toISOString().slice(0, 10)).first<{ used: number }>();
  return { enabled, daily_limit: limit, daily_used: usage?.used ?? 0, ...state };
}
export function reserveWalletQuota(db: D1Database, settings: WalletSettings, now: Date) {
  const global = reserveQuota(db, { rpc: settings.rpcDailyLimit, market: settings.marketDailyLimit }, now);
  return async () => {
    const used = await db.prepare("INSERT INTO tenx_wallet_usage(day,used) VALUES(?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<?2 RETURNING used")
      .bind(now.toISOString().slice(0, 10), settings.walletDailyLimit).first();
    if (!used) throw new SourceError("wallet_daily_budget_exhausted", Math.max(60, Math.ceil((Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000)));
    // Wallet calls are a subset of, never additional to, the global RPC cap.
    await global("rpc");
  };
}
async function collect(settings: WalletSettings, candidate: Candidate, rpc: RpcClient): Promise<WalletEvidence> {
  const db = settings.db;
  const prior = await priorWalletEvidence(db, candidate);
  const records: WalletEvidence["records"] = [], histories: WalletEvidence["histories"] = [], gaps = new Set<string>();
  let recordBytes = 0;
  async function read(signature: string, purpose: WalletEvidence["records"][number]["purposes"][number], expectedSlot?: number) {
    const already = records.find(r => r.signature === signature);
    if (already) { if (!already.purposes.includes(purpose)) already.purposes.push(purpose); return already.transaction; }
    if (records.length >= 64) { gaps.add("wallet_transaction_sample_limit"); return null; }
    const cached = await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{ payload: string; payload_hash: string; fetched_at: string }>();
    if (!cached && rpc.calls >= 18) { gaps.add("wallet_funding_history_budget_limited"); return null; }
    let transaction, fetched = cached?.fetched_at ?? new Date().toISOString();
    try {
      transaction = cached ? WalletTransactionSchema.parse(JSON.parse(cached.payload)) : await walletTransaction(rpc, signature);
      if (transaction && expectedSlot !== undefined && transaction.slot !== expectedSlot) throw new Error("wallet_signature_slot_mismatch");
      if (transaction && cached && await hashJson(transaction) !== cached.payload_hash) throw new Error("wallet_cache_hash_mismatch");
      if (transaction && !cached) {
        fetched = new Date().toISOString();
        const payload = JSON.stringify(transaction), hash = await hashJson(transaction);
        if (new TextEncoder().encode(payload).length > 250000) throw new Error("wallet_transaction_too_large");
        await db.prepare("INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at) VALUES(?1,?2,?3,?4)").bind(signature, hash, payload, fetched).run();
      }
      const size = transaction ? new TextEncoder().encode(JSON.stringify(transaction)).length : 0;
      if (recordBytes + size > 900000) { gaps.add("wallet_transaction_sample_limit"); return null; } recordBytes += size;
      records.push({ signature, purposes: [purpose], status: transaction ? "available" : "missing", transaction, fetched_at: fetched });
      return transaction;
    } catch (error) {
      if (error instanceof SourceError && ["unsupported_transaction_version", "wallet_transaction_layout_unsupported"].includes(error.code)) {
        if(expectedSlot!==undefined) await recordUnsupportedFundingRead(db,signature,expectedSlot,error.code);
        records.push({ signature, purposes: [purpose], status: "unsupported", transaction: null, fetched_at: new Date().toISOString() }); return null;
      }
      throw error;
    }
  }
  async function history(address: string, purpose: "curve" | "pool" | "wallet", limit: number, before?: string): Promise<SignatureRow[]> {
    const rows = await rpc.signatures(address, limit, before);
    histories.push({ address, purpose, rows, fetched_at: new Date().toISOString() }); return rows;
  }
  await rpc.checkCluster();
  let origin = candidate.creation ? await read(candidate.creation.signature, "origin", candidate.creation.slot) : null;
  if (!origin) gaps.add("creation_transaction_unavailable_for_wallets");
  const roles = origin ? await creationRoles(origin, candidate.address) : [];
  if (candidate.creation) {
    const curve = await curveAddress(candidate.address);
    // Anchor at the verified graduation so post-migration spam/volume cannot
    // consume the early-buy search budget or hide the creation window.
    let cached: WalletEvidence["histories"] = [];
    if (currentWalletReader(candidate.wallet_analysis?.version??"") && prior) {
      const pages = prior.histories.filter(h => h.purpose === "curve" && h.address === curve);
      // Finalized creation-window history is immutable. Reuse only a sample
      // that actually reached the independently verified creation, with its
      // original fetch timestamps; recent pool activity is still read afresh.
      if (pages.some(h => h.rows.some(r => r.signature === candidate.creation!.signature && r.slot === candidate.creation!.slot && r.err === null && r.confirmationStatus === "finalized"))) cached = pages;
    }
    let rows: SignatureRow[];
    if (cached.length) { histories.push(...cached); rows = cached.at(-1)!.rows; }
    else {
      rows = await history(curve, "curve", 1000, candidate.graduation?.signature);
      if (rows.length === 1000 && !rows.some(r => r.signature === candidate.creation!.signature)) rows = await history(curve, "curve", 1000, rows.at(-1)!.signature);
    }
    const early = rows.filter(r => r.err === null && r.confirmationStatus === "finalized" && r.slot >= candidate.creation!.slot && r.slot <= candidate.creation!.slot + 20).slice(-5).reverse();
    for (const row of early) await read(row.signature, "early", row.slot);
  } else gaps.add("creation_slot_unknown");
  // Keep every prior sampled-buy anchor in the next full snapshot. New recent
  // activity must not silently erase a buyer or strand its funding checkpoint.
  for (const scan of prior?.funding_scans ?? []) if (scan.anchor.kind === "sampled_buy") await read(scan.anchor.signature, "recent", scan.anchor.slot);
  const recent = await history(candidate.pool, "pool", 24);
  const successful = recent.filter(r => r.err === null && r.confirmationStatus === "finalized"), count = Math.min(5, successful.length);
  for (let i = 0; i < count; i++) { const row = successful[count === 1 ? 0 : Math.floor(i * (successful.length - 1) / (count - 1))]!; await read(row.signature, "recent", row.slot); }
  const trades = (await Promise.all(records.filter(r => r.transaction).map(async r => {
    try { return (await verifiedTrades(r.transaction!, candidate.address, candidate.pool, { temporaryWsol: true })).trades; } catch { return []; }
  }))).flat();
  const buyers = [...new Set(trades.filter(t => t.side === "buy").sort((a, b) => a.slot - b.slot || a.wallet.localeCompare(b.wallet)).map(t => t.wallet))];
  const anchors: FundingAnchor[] = [];
  if (candidate.creation) for (const role of roles.filter(r => r.signed)) if (!anchors.some(a => a.wallet === role.wallet)) anchors.push({ wallet: role.wallet, signature: candidate.creation.signature, slot: candidate.creation.slot, block_time: candidate.creation.block_time, kind: "signed_creation" });
  for (const wallet of buyers) {
    if (anchors.some(a => a.wallet === wallet)) continue;
    const first = trades.filter(t => t.wallet === wallet && t.side === "buy").sort((a, b) => a.slot - b.slot || a.signature.localeCompare(b.signature))[0]!;
    anchors.push({ wallet, signature: first.signature, slot: first.slot, block_time: first.block_time, kind: "sampled_buy" });
  }
  if (anchors.length > DIRECT_FUNDING_WALLETS) gaps.add("funding_wallet_limit");
  const readFunding = async (signature: string, slot: number, status?: "missing" | "unsupported") => {
    if (!records.some(r => r.signature === signature) && records.length >= 64) { gaps.add("wallet_transaction_sample_limit"); return null; }
    if (status && !records.some(r => r.signature === signature)) records.push({ signature, purposes: ["wallet"], status, transaction: null, fetched_at: new Date().toISOString() });
    else await read(signature, "wallet", slot);
    const record = records.find(r => r.signature === signature);
    return record ? { transaction: record.transaction, status: record.status } : null;
  };
  // Direct pre-buy coverage is an eligibility gate. Second-hop expansion uses
  // the remaining calls after direct work, within the same 18-call ceiling.
  const scans = await collectFundingHistories(db, rpc, candidate.address, anchors, readFunding, { rpcCeiling: 18,cacheRecovery:true,directWalletLimit:20 });
  const devs = new Set(roles.filter(r => r.signed).map(r => r.wallet));
  const baseTransactions = records.flatMap(r => r.transaction ? [r.transaction] : []);
  const outflows = await buildSecondHopOutflows(baseTransactions, candidate.address, candidate.pool, candidate.creation?.slot ?? null, devs, scans.map(s => s.anchor), true);
  const secondScans = await collectFundingHistories(db, rpc, candidate.address, secondHopAnchors(outflows, devs), readFunding, { secondHop: true,cacheRecovery:true });
  const holders=await walletHolderInputFromStore(d1EvidenceReadStore(db),candidate);
  const priorLosses = new Map<string, { tokens: Set<string>; hashes: Set<string> }>();
  const reports = await db.prepare(`SELECT payload FROM (SELECT day,payload,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at DESC,input_hash) AS position FROM tenx_reviews WHERE created_at>=?1) WHERE position=1 ORDER BY day DESC LIMIT 30`).bind(new Date(Date.now() - 30 * 86400000).toISOString()).all<{ payload: string }>();
  for (const report of reports.results.map(r => ReviewSchema.parse(JSON.parse(r.payload)))) for (const outcome of report.outcomes.filter(o => o.status === "measured" && o.outcome === "severe_loss_signal" && Date.parse(o.endpoint_at ?? "") <= Date.now())) for (const w of outcome.wallets) {
    if (![...roles.map(r => r.wallet), ...buyers].includes(w.wallet)) continue;
    const entry = priorLosses.get(w.wallet) ?? { tokens: new Set(), hashes: new Set() }; entry.tokens.add(outcome.address); entry.hashes.add(report.input_hash); priorLosses.set(w.wallet, entry);
  }
  return WalletEvidenceSchema.parse({ version: "wallet-input-v5", funding_scans: scans, second_hop_scans: secondScans, observed_at: new Date().toISOString(), cluster: MAINNET_GENESIS,
    asset: { address: candidate.address, pool: candidate.pool, token_program: candidate.risk.token_program, creation: candidate.creation, graduation: candidate.graduation }, records, histories, holders,
    prior_losses: [...priorLosses].slice(0, 20).map(([wallet, p]) => ({ wallet, tokens: [...p.tokens].sort().slice(0, 100), report_hashes: [...p.hashes].sort().slice(0, 30) })), gaps: [...gaps] });
}
export async function runWalletCycle(settings: WalletSettings, address?: string, now = new Date()): Promise<Record<string, unknown>> {
  const db = settings.db, at = now.toISOString(), owner = crypto.randomUUID();
  if (!settings.walletEnabled) return { state: "disabled" };
  const shared = await control(db);
  if (shared.paused) return { state: "paused" };
  if (shared.retry_after && shared.retry_after > at && shared.last_error?.startsWith("rpc_")) return { state: "waiting", reason: "shared_rpc_backoff" };
  if (address) Address.parse(address);
  const all = await candidates(db), active = shortlist(all, DEFAULT_POLICY, now);
  const catchup = await db.prepare("SELECT used FROM tenx_usage WHERE provider='wallet_catchup' AND day=?1").bind(at.slice(0, 10)).first<{used:number}>();
  const allowance = catchupLimit(settings.walletDailyLimit), rapid = active.filter(c => c.eligibility === "eligible").length < 10 && (catchup?.used ?? 0) + 18 <= allowance;
  const rpc = new RpcClient(settings.rpcUrl, reserveWalletQuota(db, settings, now), settings.transport, 18);
  const lease = await db.prepare(`UPDATE tenx_wallet_control SET lease_owner=?1,lease_until=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<?3) AND ((?4=1 AND last_error IS NULL) OR next_refresh_at IS NULL OR next_refresh_at<=?3) RETURNING id`)
    .bind(owner, new Date(now.getTime() + 360000).toISOString(), at, address || rapid ? 1 : 0).first();
  if (!lease) return { state: "waiting" };
  let selectedAddress: string | null = null;
  let selected: Candidate | undefined, selectedPlan: WalletPlan | undefined, kind = "snapshot";
  const runRow = (state: string, completed: number, buyers: number, error: string | null = null) => db.prepare("INSERT OR IGNORE INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)").bind(owner,selectedAddress,selected?.wallet_analysis?.evidence_hash ?? null,kind,state,at,new Date().toISOString(),rpc.calls,completed,buyers,error);
  try {
    const work = new Map((await walletWork(db)).map(w => [w.address, w]));
    const attempts = await db.prepare("SELECT address,attempted_at,next_attempt_at FROM tenx_wallet_attempts").all<{ address: string; attempted_at: string; next_attempt_at: string }>();
    const tried = new Map(attempts.results.map(r => [r.address, r]));
    const planned = [];
    if (!address) for (const c of active.filter(c=>potential(c,DEFAULT_POLICY,now) && (!tried.get(c.address) || tried.get(c.address)!.next_attempt_at<=at)).slice(0,20)) {
      const plan=await walletPlan(db,c,now);
      if (!["source_limited","cache_invalid"].includes(plan.stage)) planned.push({candidate:c,plan});
    }
    planned.sort((a,b)=>compareWalletPlans(a,b,now) || (tried.get(a.candidate.address)?.attempted_at ?? "").localeCompare(tried.get(b.candidate.address)?.attempted_at ?? "") || comparePotential(a.candidate,b.candidate,DEFAULT_POLICY,now));
    let candidate = address ? all.find(c => c.address === address) : planned[0]?.candidate;
    if (address && !candidate) {
      const saved = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(address).first<{ payload: string }>();
      if (saved) candidate = CandidateSchema.parse(JSON.parse(saved.payload));
    }
    if (!candidate) { await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(now.getTime() + 300000).toISOString(), owner).run(); return { state: "empty" }; }
    selectedAddress = candidate.address;
    selected = candidate; selectedPlan = planned.find(p=>p.candidate.address===candidate.address)?.plan ?? await walletPlan(db,candidate,now);
    if (["source_limited","cache_invalid"].includes(selectedPlan.stage)) {
      await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(now.getTime()+300000).toISOString(),owner).run();
      return {state:"waiting",reason:selectedPlan.stage,address:candidate.address,plan:selectedPlan,rpc_calls:0};
    }
    const used = await db.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?1").bind(at.slice(0, 10)).first<{ used: number }>();
    const left = Math.max(1, settings.walletDailyLimit - (used?.used ?? 0)), seconds = (Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000;
    // A bounded catch-up reserve brings unfinished windows forward without
    // increasing either daily allowance. Normal pacing uses observed work cost.
    const catchupSlot = selectedPlan.stage !== "cached_funding" && rapid && active.filter(c => c.eligibility === "eligible").length < 10 ? await db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('wallet_catchup',?1,18) ON CONFLICT(provider,day) DO UPDATE SET used=used+18 WHERE used+18<=?2 RETURNING used").bind(at.slice(0,10),allowance).first() : null;
    const spacingFor = (cost:number) => catchupSlot ? 60 : Math.min(seconds + 60, Math.max(60, Math.min(7200, Math.ceil(seconds * Math.max(1,Math.min(18,cost)) / left))));
    const spacing = spacingFor(selectedPlan.minimum_rpc_calls ?? work.get(candidate.address)?.rpc_calls ?? 18);
    await db.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(now.getTime() + spacing * 1000).toISOString(), owner).run();
    if (selectedPlan.stage === "cached_funding") {
      kind = "funding";
      if (!potential(candidate, DEFAULT_POLICY, now)) throw new Error("funding_cache_not_current_contender");
      try {
        const progress = await continueCachedFunding(db, candidate, owner, now);
        if (await recordCachedFundingWork(db, candidate, owner, at, progress, Math.max(0, progress.examined_windows - selectedPlan.examined_windows)))
          return { state: "progressed", address: candidate.address, rpc_calls: 0, progress, snapshot_updated: false, source: "verified_cache" };
      } catch (error) {
        if (!(error instanceof Error && error.message === "funding_cache_checkpoint_or_owner_changed")) throw error;
      }
      await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(Date.now()+60000).toISOString(), owner).run();
      return { state: "waiting", reason: "funding_cache_checkpoint_or_owner_changed", rpc_calls: 0 };
    }
    if(selectedPlan.stage === "reader_recovery") {
      kind="funding";
      // Recovery is collection priority only; it cannot bypass the current
      // contender/age/risk filter, including on an explicit operator request.
      if(!potential(candidate,DEFAULT_POLICY,now)) throw new Error("funding_recovery_not_current_contender");
      const prior=await priorWalletEvidence(db,candidate);
      if(!prior) throw new Error("funding_recovery_evidence_missing");
      const recovery=await recoverFundingBodies(db,candidate,prior,rpc,owner,now);
      await db.batch([
        runRow("succeeded",0,0),
        db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(candidate.address,at,new Date(now.getTime()+60000).toISOString()),
        db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_address=?1,last_error=NULL,next_refresh_at=?3 WHERE id=1 AND lease_owner=?2").bind(candidate.address,owner,new Date(now.getTime()+spacingFor(rpc.calls)*1000).toISOString()),
      ]);
      return {state:"progressed",address:candidate.address,rpc_calls:rpc.calls,recovery,snapshot_updated:false};
    }
    if (selectedPlan.stage === "direct_funding") {
      kind = "funding";
      const progress = await continueFunding(db, candidate, rpc);
      await db.batch([
        runRow("succeeded",Math.max(0,progress.examined_windows-selectedPlan.examined_windows),0),
        db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(candidate.address, at, new Date(now.getTime() + (progress.stage === "refresh_required" ? 60000 : progress.stage === "source_limited" ? 3600000 : 300000)).toISOString()),
        db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_address=?1,last_error=NULL,next_refresh_at=?3 WHERE id=1 AND lease_owner=?2").bind(candidate.address,owner,new Date(now.getTime()+spacingFor(rpc.calls)*1000).toISOString()),
      ]);
      return { state: "progressed", address: candidate.address, rpc_calls: rpc.calls, progress, snapshot_updated: false };
    }
    const evidence = await collect(settings, candidate, rpc);
    const payload = JSON.stringify(evidence); if (new TextEncoder().encode(payload).length > 1800000) throw new Error("wallet_evidence_size_limit");
    const analysis = await analyzeWalletEvidence(evidence);
    const statements = [
      runRow("succeeded",Math.max(0,(analysis.funding_coverage?.filter(f=>f.status==="window_examined").length ?? 0)-selectedPlan.examined_windows),Math.max(0,analysis.metrics.distinct_buyers-(candidate.wallet_analysis?.metrics.distinct_buyers ?? 0))),
      d1EvidenceWriteStore(db).wallet({payload_hash:analysis.evidence_hash,address:candidate.address,payload,observed_at:analysis.observed_at}),
      db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address=?2 AND mode='live'").bind(JSON.stringify(analysis), candidate.address),
      db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(candidate.address, at, new Date(now.getTime() + 3600000).toISOString()),
      db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_success=?1,last_address=?2,last_error=NULL,next_refresh_at=?4 WHERE id=1 AND lease_owner=?3").bind(analysis.observed_at, candidate.address, owner,new Date(now.getTime()+spacingFor(rpc.calls)*1000).toISOString()),
      db.prepare("DELETE FROM tenx_wallet_work WHERE address=?1").bind(candidate.address),
    ];
    for (const wallet of analysis.wallets) statements.push(db.prepare("INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(address,wallet) DO UPDATE SET payload_hash=excluded.payload_hash,payload=excluded.payload,observed_at=excluded.observed_at").bind(candidate.address, wallet.wallet, analysis.evidence_hash, JSON.stringify(wallet), analysis.observed_at));
    await db.batch(statements);
    const current = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(candidate.address).first<{ payload: string }>();
    if (current) await captureCohort(db, CandidateSchema.parse(JSON.parse(current.payload)), evidence.observed_at);
    return { state: "succeeded", address: candidate.address, rpc_calls: rpc.calls, evidence_hash: analysis.evidence_hash, status: analysis.status, verified_buys: analysis.metrics.verified_buys, signals: analysis.signals.map(s => s.code) };
  } catch (error) {
    await persistRpcBackoff(db, error, now);
    const code = error instanceof SourceError ? error.code : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "wallet_evidence_not_certified";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 300;
    if (selectedAddress) await runRow("failed",0,0,code).run();
    await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3").bind(new Date(now.getTime() + retry * 1000).toISOString(), code, owner).run();
    if (selectedAddress) await db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(selectedAddress, at, new Date(now.getTime() + Math.max(retry, 3600) * 1000).toISOString()).run();
    return { state: "failed", error_code: code, rpc_calls: rpc.calls };
  }
}
