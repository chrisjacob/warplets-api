import { z } from "zod";
import { assess, CandidateSchema, DEFAULT_POLICY, shortlist } from "./model";
import { hashJson } from "./solana";
import { verifiedTrades, validWalletTransaction } from "./wallet-trades";
import { BackingEvidence, BackingListResponse, BackingOpening, BackingRecord, BackingResult, BackingSummary, OpenBackingRequest, type Opening, type Evidence, type Result, type Record as RunRecord } from "./backing-model";

export class BackingError extends Error { constructor(message: string, readonly status = 503) { super(message); } }
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
function bounded(v: unknown, limit: number) { if (size(v) > limit) throw new BackingError("backing_snapshot_size_limit"); }
function sqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + value / x) / 2n; } return x;
}
function checkOpening(opening:Opening){
  const start=Date.parse(opening.starts_at),end=Date.parse(opening.ends_at);
  if(!(end>start&&end-start<=86400000&&Date.parse(opening.deadline)===end+300000))throw new BackingError("backing_window_mismatch");
  if(opening.candidates.some(c=>c.mode!=="live"))throw new BackingError("backing_fixture_input");
  if(opening.candidates.some(c=>sourceTimes(c).some(t=>Date.parse(t)>start)))throw new BackingError("backing_opening_evidence_from_future",409);
  if(new Set(opening.members.map(m=>m.address)).size!==opening.members.length||opening.members.some(m=>Date.parse(m.linked_at)>start))throw new BackingError("backing_membership_mismatch");
}
const sourceTimes=(c:Opening["candidates"][number])=>[c.checked_at,c.creation?.fetched_at,c.graduation?.fetched_at,c.market?.fetched_at,c.market?.observed_at,c.risk.observed_at,c.holders?.observed_at,c.wallet_analysis?.observed_at].filter((v):v is string=>Boolean(v));
export async function evaluateBacking(rawOpening: Opening, rawEvidence: Evidence): Promise<Result> {
  const opening = BackingOpening.parse(rawOpening), evidence = BackingEvidence.parse(rawEvidence);
  checkOpening(opening);
  const start = Date.parse(opening.starts_at), end = Date.parse(opening.ends_at), deadline = Date.parse(opening.deadline);
  if (!(end > start && end - start <= 86400000 && deadline === end + 300000 && Date.parse(evidence.frozen_at) >= deadline)) throw new BackingError("backing_window_mismatch");
  const tokens = new Map(opening.candidates.map(c => [c.address, c])), closing = new Map(evidence.closing_candidates.map(c => [c.address, c]));
  if (tokens.size !== opening.candidates.length || closing.size !== evidence.closing_candidates.length || [...closing.keys()].some(k => !tokens.has(k))) throw new BackingError("backing_candidate_mismatch");
  if ([...opening.candidates,...evidence.closing_candidates].some(c=>c.mode!=="live")) throw new BackingError("backing_fixture_input");
  const members = new Map(opening.members.map(m => [m.address, m.identity_id]));
  if (members.size !== opening.members.length || opening.members.some(m => Date.parse(m.linked_at) > start)) throw new BackingError("backing_membership_mismatch");
  const atOpen = new Map(opening.candidates.map(c => [c.address, assess(c, opening.policy, new Date(start)).eligibility === "eligible"]));
  const atClose = new Map([...closing].map(([address, c]) => [address, sourceTimes(c).every(t=>Date.parse(t)<=end) && assess(c, opening.policy, new Date(end)).eligibility === "eligible"]));
  const entries: Result["entries"] = [], seen = new Map<string, string>(); let ignored = 0;
  const records = [...evidence.transactions].sort((a,b) => a.transaction.slot - b.transaction.slot || ascii(a.signature,b.signature));
  const signatures = new Set<string>();
  for (const row of records) {
    const tx = row.transaction;
    if (signatures.has(row.signature)) throw new BackingError("backing_duplicate_transaction"); signatures.add(row.signature);
    if (await hashJson(tx) !== row.payload_hash || tx.transaction.signatures[0] !== row.signature) throw new BackingError("backing_transaction_hash_mismatch");
    const fetched = Date.parse(row.fetched_at), block = tx.blockTime === null ? NaN : tx.blockTime * 1000;
    if (!Number.isFinite(block) || fetched > deadline || block > fetched) throw new BackingError("backing_transaction_time_mismatch");
    // Window is [start,end); source watermark is the fixed end + five minutes.
    if (block < start || block >= end) { ignored++; continue; }
    try { validWalletTransaction(tx); } catch { ignored++; continue; }
    for (const candidate of opening.candidates) {
      if (!tx.meta!.preTokenBalances.concat(tx.meta!.postTokenBalances).some(b => b.mint === candidate.address)) continue;
      const decoded = await verifiedTrades(tx, candidate.address, candidate.pool, { temporaryWsol: true });
      for (const trade of decoded.trades) {
        const key = `${candidate.address}:${trade.signature}:${trade.instruction_index}`, hash = await hashJson(trade);
        if (seen.has(key)) { if (seen.get(key) !== hash) throw new BackingError("backing_conflicting_instruction"); continue; } seen.set(key, hash);
        const reasons: string[] = [];
        if (!atOpen.get(candidate.address)) reasons.push("candidate_ineligible_at_open");
        if (!atClose.get(candidate.address)) reasons.push("candidate_ineligible_at_close");
        if (!members.has(trade.wallet)) reasons.push("wallet_not_linked_at_open");
        if (evidence.revoked_wallets.includes(trade.wallet)) reasons.push("wallet_unlinked_during_window");
        if (trade.quote_amount_raw === null) reasons.push("quote_amount_unmeasured");
        if (decoded.gaps.length) reasons.push("transaction_decode_incomplete");
        const risk = atClose.get(candidate.address) ? closing.get(candidate.address)?.wallet_analysis?.signals ?? [] : [];
        if (risk.some(s => s.wallets.includes(trade.wallet) && /fund|same_transaction|same_slot|fee_payer|round_trip/.test(s.code))) reasons.push("funding_or_coordination_signal");
        entries.push({ ...trade, mint: candidate.address, identity_id: members.get(trade.wallet) ?? null, reasons });
        if (entries.length > 1000) throw new BackingError("backing_ledger_entry_limit");
      }
    }
  }
  const groupMap = new Map<string, Result["entries"]>();
  for (const e of entries) if (e.identity_id) { const key = `${e.mint}:${e.identity_id}`; const group = groupMap.get(key) ?? []; group.push(e); groupMap.set(key, group); }
  const groups: Result["groups"] = [];
  const usd = (quote: bigint) => quote * BigInt(opening.assumptions.assumed_sol_usd) * 1000000n / 1000000000n;
  for (const rows of groupMap.values()) {
    const reasons = new Set(rows.flatMap(e => e.reasons)); let base = 0n, quote = 0n, creditedQuote = 0n;
    const byWalletTx = new Map<string, typeof rows>();
    for (const e of rows) {
      const sign = e.side === "buy" ? 1n : -1n, amount = BigInt(e.quote_amount_raw ?? "0");
      base += sign * BigInt(e.base_amount_raw); quote += sign * amount;
      // All sells subtract, including old holdings; subminimum buys add no value.
      if (e.side === "sell" || usd(amount) >= BigInt(opening.assumptions.minimum_trade_usd) * 1000000n) creditedQuote += sign * amount;
      const key = `${e.wallet}:${e.signature}`; const group = byWalletTx.get(key) ?? []; group.push(e); byWalletTx.set(key, group);
    }
    for (const txRows of byWalletTx.values()) {
      const net = txRows.reduce((n,e) => n + (e.side === "buy" ? 1n : -1n) * BigInt(e.base_amount_raw),0n);
      if (net !== BigInt(txRows[0]!.net_wallet_base_raw)) reasons.add("nontrade_transfer_or_incomplete_decode");
      if (txRows.some(e => e.side === "buy") && txRows.some(e => e.side === "sell")) reasons.add("same_transaction_round_trip");
    }
    if (base <= 0n) reasons.add("no_positive_net_token_purchase");
    const netUsd = usd(creditedQuote > 0n ? creditedQuote : 0n);
    if (netUsd < BigInt(opening.assumptions.minimum_trade_usd) * 1000000n) reasons.add("below_minimum_net_purchase");
    const cap = BigInt(opening.assumptions.per_identity_cap_usd) * 1000000n;
    const value = reasons.size ? 0n : netUsd > cap ? cap : netUsd;
    groups.push({ mint: rows[0]!.mint, identity_id: rows[0]!.identity_id!, buys: rows.filter(e => e.side === "buy").length, sells: rows.filter(e => e.side === "sell").length,
      net_base_raw: base.toString(), net_quote_lamports_raw: quote.toString(), hypothetical_net_usd_micros: netUsd.toString(),
      linear_projection_micros: value.toString(), sqrt_projection_micros: sqrt(value * 1000000n).toString(), reasons: [...reasons].sort(ascii) });
  }
  groups.sort((a,b) => ascii(a.mint,b.mint) || ascii(a.identity_id,b.identity_id));
  const projections = opening.candidates.map(c => {
    const own = groups.filter(g => g.mint === c.address);
    return { mint: c.address, symbol: c.symbol, eligible_at_open: atOpen.get(c.address)!, eligible_at_close: atClose.get(c.address) ?? false,
      linear_micros: own.reduce((n,g) => n + BigInt(g.linear_projection_micros),0n).toString(), sqrt_micros: own.reduce((n,g) => n + BigInt(g.sqrt_projection_micros),0n).toString(),
      identities_projected: own.filter(g => !g.reasons.length).length, identities_held: own.filter(g => g.reasons.length).length };
  }).sort((a,b) => ascii(a.mint,b.mint));
  return BackingResult.parse({ version: "backing-result-v1", algorithm: "backing-experiment-v1", outcome: "withheld", winner_address: null, voting_enabled: false, rewards_enabled: false,
    pricing: "hypothetical_fixed_SOL_USD_not_verified_valuation", coverage: "bounded_cache_not_exhaustive", entries, groups, projections,
    ignored_transactions: ignored, max_examined_slot: records.length ? Math.max(...records.map(r => r.transaction.slot)) : null,
    gaps: ["source_coverage_not_exhaustive", "historical_USD_valuation_unverified", "genuine_buyer_and_sybil_checks_unverified", "daily_cross_window_cap_not_implemented", "independent_finalized_slot_watermark_not_available", "D07_scoring_not_approved", "no_live_vote_credit", ...(evidence.scan_limited ? ["transaction_scan_limit_reached"] : [])] });
}
type Row = { id: string; request_hash: string; opening: string; opening_hash: string; state: string; evidence: string | null; evidence_hash: string | null; result: string | null; result_hash: string | null; record_hash: string | null; last_error: string | null };
async function row(db: D1Database,id: string) { return db.prepare("SELECT * FROM tenx_backing_runs WHERE id=?").bind(z.uuid().parse(id)).first<Row>(); }
async function record(saved: Row): Promise<RunRecord | null> {
  const opening = BackingOpening.parse(JSON.parse(saved.opening));
  if (await hashJson(opening) !== saved.opening_hash || saved.id !== opening.id) throw new BackingError("backing_opening_hash_mismatch");
  if (saved.state === "open") return null;
  const evidence = BackingEvidence.parse(JSON.parse(saved.evidence!)), result = BackingResult.parse(JSON.parse(saved.result!));
  const evidenceHash = await hashJson(evidence), resultHash = await hashJson(result);
  if (evidenceHash !== saved.evidence_hash || resultHash !== saved.result_hash || await hashJson({ opening_hash: saved.opening_hash, evidence_hash: evidenceHash, result_hash: resultHash }) !== saved.record_hash || await hashJson(await evaluateBacking(opening,evidence)) !== resultHash) throw new BackingError("backing_replay_mismatch");
  return BackingRecord.parse({ opening, opening_hash: saved.opening_hash, evidence, evidence_hash: evidenceHash, result, result_hash: resultHash, record_hash: saved.record_hash });
}
export async function backingRecord(db: D1Database,id: string) { const saved = await row(db,id); return saved ? record(saved) : null; }
async function summary(saved: Row) {
  const opening = BackingOpening.parse(JSON.parse(saved.opening));
  if (await hashJson(opening) !== saved.opening_hash) throw new BackingError("backing_opening_hash_mismatch");
  const result = saved.state === "frozen" ? BackingResult.parse(JSON.parse(saved.result!)) : null;
  if (result && (await hashJson(result) !== saved.result_hash || await hashJson({opening_hash:saved.opening_hash,evidence_hash:saved.evidence_hash,result_hash:saved.result_hash}) !== saved.record_hash)) throw new BackingError("backing_result_hash_mismatch");
  return BackingSummary.parse({ id: saved.id, starts_at: opening.starts_at, ends_at: opening.ends_at, deadline: opening.deadline, state: saved.state, assumptions: opening.assumptions,
    candidate_count: opening.candidates.length, eligible_at_open: opening.candidates.filter(c => assess(c,opening.policy,new Date(opening.starts_at)).eligibility === "eligible").length,
    frozen_wallet_count: opening.members.length, entries: result?.entries.length ?? 0, groups: result?.groups.length ?? 0, projections: result?.projections ?? [],
    entry_reasons: Object.fromEntries([...new Set(result?.entries.flatMap(e=>e.reasons) ?? [])].sort(ascii).map(reason=>[reason,result!.entries.filter(e=>e.reasons.includes(reason)).length])),
    opening_hash: saved.opening_hash, record_hash: saved.record_hash, replay: result ? "hash_checked" : "pending", last_error: saved.last_error, outcome: "withheld", voting_enabled: false,
    gaps: result?.gaps ?? ["prospective_window_waiting_for_source_deadline", "no_live_vote_credit"] });
}
export async function backingList(db: D1Database) {
  const saved = await db.prepare("SELECT id,request_hash,opening,opening_hash,state,result,result_hash,evidence_hash,record_hash,last_error FROM tenx_backing_runs ORDER BY created_at DESC,id LIMIT 10").all<Row>();
  return BackingListResponse.parse({ scope: "local_backing_rehearsals", runs: await Promise.all(saved.results.map(summary)), provider_requests: 0, voting_enabled: false });
}
export async function openBacking(db: D1Database, raw: unknown, now = new Date()) {
  const request = OpenBackingRequest.parse(raw), requestHash = await hashJson(request), existing = await row(db,request.request_id);
  if (existing) { if (existing.request_hash !== requestHash) throw new BackingError("backing_request_conflict",409); return summary(existing); }
  const start = now.toISOString(), end = new Date(now.getTime() + request.duration_minutes * 60000).toISOString();
  const all = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' ORDER BY address LIMIT 501").all<{payload:string}>();
  if (all.results.length > 500) throw new BackingError("backing_candidate_inventory_limit");
  const membership = await db.prepare("SELECT (SELECT COALESCE(MAX(rowid),0) FROM tenx_identity_audit) AS watermark, (SELECT json_group_array(json_object('address',address,'identity_id',identity_id,'linked_at',linked_at)) FROM (SELECT * FROM tenx_identity_wallets WHERE linked_at<=? ORDER BY address LIMIT 1001)) AS members").bind(start).first<{watermark:number;members:string}>();
  const inventory = all.results.map(r => CandidateSchema.parse(JSON.parse(r.payload)));
  const selected = shortlist(inventory,DEFAULT_POLICY,now).slice(0,20).map(c => inventory.find(v => v.address === c.address)!);
  const members:unknown[]=JSON.parse(membership!.members);
  if(members.length>1000)throw new BackingError("backing_membership_capacity_limit");
  const opening = BackingOpening.parse({ version: "backing-opening-v1", id: request.request_id, starts_at: start, ends_at: end, deadline: new Date(Date.parse(end)+300000).toISOString(),
    policy: DEFAULT_POLICY, assumptions: request.assumptions, candidates: selected, members, candidate_scope: "up_to_20_observed_contenders" });
  checkOpening(opening);
  bounded(opening,650000); const openingHash = await hashJson(opening);
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO tenx_backing_runs(id,request_hash,created_at,ends_at,deadline,state,opening,opening_hash) SELECT ?,?,?,?,?,'open',?,? WHERE NOT EXISTS(SELECT 1 FROM tenx_backing_runs WHERE state='open') AND (SELECT COUNT(*) FROM tenx_backing_runs WHERE substr(created_at,1,10)=?)<20 AND (SELECT COALESCE(MAX(rowid),0) FROM tenx_identity_audit)=?").bind(opening.id,requestHash,start,end,opening.deadline,JSON.stringify(opening),openingHash,start.slice(0,10),membership!.watermark),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?,'backing_open','local-operator',?,?,? WHERE EXISTS(SELECT 1 FROM tenx_backing_runs WHERE id=? AND opening_hash=?)").bind(`backing-open:${opening.id}`,request.reason,openingHash,start,opening.id,openingHash),
  ]);
  const saved = await row(db,opening.id);
  if (!saved) throw new BackingError("backing_active_daily_limit_or_membership_changed",409);
  if (saved.request_hash !== requestHash) throw new BackingError("backing_request_conflict",409);
  return summary(saved);
}
export async function freezeBacking(db: D1Database,id: string, now = new Date()) {
  const saved = await row(db,id); if (!saved) throw new BackingError("backing_not_found",404);
  if (saved.state === "frozen") return summary(saved);
  const opening = BackingOpening.parse(JSON.parse(saved.opening));
  if (await hashJson(opening) !== saved.opening_hash) throw new BackingError("backing_opening_hash_mismatch");
  if (now.toISOString() < opening.deadline) throw new BackingError("backing_source_deadline_not_reached",409);
  const inventory = await db.prepare("SELECT signature,length(CAST(payload AS BLOB)) AS bytes FROM tenx_wallet_transactions WHERE fetched_at>=? AND fetched_at<=? AND json_extract(payload,'$.blockTime')>=? AND json_extract(payload,'$.blockTime')<? ORDER BY fetched_at,signature LIMIT 101").bind(opening.starts_at,opening.deadline,Date.parse(opening.starts_at)/1000,Date.parse(opening.ends_at)/1000).all<{signature:string;bytes:number}>();
  const selected: string[] = []; let bytes=0;
  for (const r of inventory.results) { if (selected.length===100 || bytes+r.bytes>750000) break; selected.push(r.signature); bytes+=r.bytes; }
  const transactions = await db.prepare("SELECT signature,payload_hash,fetched_at,payload FROM tenx_wallet_transactions WHERE signature IN (SELECT value FROM json_each(?)) ORDER BY fetched_at,signature").bind(JSON.stringify(selected)).all<{signature:string;payload_hash:string;fetched_at:string;payload:string}>();
  const closing = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address IN (SELECT value FROM json_each(?)) ORDER BY address").bind(JSON.stringify(opening.candidates.map(c => c.address))).all<{payload:string}>();
  const revoked = await db.prepare("SELECT DISTINCT address FROM tenx_identity_audit WHERE action='unlink' AND created_at>=? AND created_at<=? AND address IN (SELECT value FROM json_each(?)) ORDER BY address").bind(opening.starts_at,opening.deadline,JSON.stringify(opening.members.map(m=>m.address))).all<{address:string}>();
  // Explicitly bounded cache, never claimed to be an exhaustive election index.
  const evidence = BackingEvidence.parse({ version:"backing-evidence-v1",frozen_at:now.toISOString(),closing_candidates:closing.results.map(r=>CandidateSchema.parse(JSON.parse(r.payload))),revoked_wallets:revoked.results.map(r=>r.address),
    transactions:transactions.results.map(r=>({signature:r.signature,payload_hash:r.payload_hash,fetched_at:r.fetched_at,transaction:JSON.parse(r.payload)})),scan_limited:inventory.results.length>selected.length,source:"cached_finalized_mainnet_rpc" });
  bounded(evidence,950000); const result = await evaluateBacking(opening,evidence); bounded(result,250000);
  const evidenceHash=await hashJson(evidence),resultHash=await hashJson(result);
  const recordHash = await hashJson({opening_hash:saved.opening_hash,evidence_hash:evidenceHash,result_hash:resultHash});
  await db.batch([
    db.prepare("UPDATE tenx_backing_runs SET state='frozen',evidence=?,evidence_hash=?,result=?,result_hash=?,record_hash=?,last_error=NULL WHERE id=? AND state='open' AND opening_hash=?").bind(JSON.stringify(evidence),evidenceHash,JSON.stringify(result),resultHash,recordHash,id,saved.opening_hash),
    db.prepare("INSERT OR IGNORE INTO tenx_audit(id,action,actor,reason,data_hash,created_at) SELECT ?,'backing_freeze','local-maintenance','Fixed source deadline; bounded cached evidence, no votes',?,? WHERE EXISTS(SELECT 1 FROM tenx_backing_runs WHERE id=? AND record_hash=?)").bind(`backing-freeze:${id}`,recordHash,now.toISOString(),id,recordHash),
  ]);
  return summary((await row(db,id))!);
}
export async function settleBacking(db: D1Database,now = new Date()) {
  const saved = await db.prepare("SELECT id FROM tenx_backing_runs WHERE state='open' AND deadline<=? LIMIT 1").bind(now.toISOString()).first<{id:string}>();
  if (!saved) return {state:"waiting"};
  try { return {state:"frozen",run:await freezeBacking(db,saved.id,now)}; }
  catch(error) { const code=error instanceof BackingError ? error.message : "backing_freeze_unavailable"; await db.prepare("UPDATE tenx_backing_runs SET last_error=? WHERE id=? AND state='open'").bind(code,saved.id).run(); return {state:"failed",error:code}; }
}
