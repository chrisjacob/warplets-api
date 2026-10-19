import { Address, CandidateSchema, DEFAULT_POLICY, shortlist, type Candidate } from "./model";
import { analyzeWalletEvidence, WalletEvidenceSchema, type WalletEvidence } from "./wallet-analysis";
import { creationRoles, verifiedTrades } from "./wallet-trades";
import { walletTransaction, WalletTransactionSchema } from "./wallet-rpc";
import { candidates, captureCohort, control, reserveQuota } from "./store";
import { MAINNET_GENESIS, RpcClient, SourceError, SignatureRows, type SignatureRow } from "./rpc";
import { curveAddress } from "./pump";
import { hashJson } from "./solana";
import { HolderEvidenceSchema } from "./holders";
import { ReviewSchema } from "./research-model";
import type { Settings } from "./ingest";

export type WalletSettings = Settings & { walletEnabled: boolean; walletDailyLimit: number };
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
  const records: WalletEvidence["records"] = [], histories: WalletEvidence["histories"] = [], gaps = new Set<string>();
  async function read(signature: string, purpose: WalletEvidence["records"][number]["purposes"][number], expectedSlot?: number) {
    const already = records.find(r => r.signature === signature);
    if (already) { if (!already.purposes.includes(purpose)) already.purposes.push(purpose); return already.transaction; }
    if (records.length >= 12 || rpc.calls >= 17) { gaps.add("wallet_transaction_sample_limit"); return null; }
    const cached = await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(signature).first<{ payload: string; payload_hash: string; fetched_at: string }>();
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
      records.push({ signature, purposes: [purpose], status: transaction ? "available" : "missing", transaction, fetched_at: fetched });
      return transaction;
    } catch (error) {
      if (error instanceof SourceError && ["unsupported_transaction_version", "wallet_transaction_layout_unsupported"].includes(error.code)) {
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
    let rows = await history(curve, "curve", 1000);
    if (rows.length === 1000 && !rows.some(r => r.signature === candidate.creation!.signature)) rows = await history(curve, "curve", 1000, rows.at(-1)!.signature);
    const early = rows.filter(r => r.err === null && r.confirmationStatus === "finalized" && r.slot >= candidate.creation!.slot && r.slot <= candidate.creation!.slot + 20).slice(-5).reverse();
    for (const row of early) await read(row.signature, "early", row.slot);
  } else gaps.add("creation_slot_unknown");
  const recent = await history(candidate.pool, "pool", 12);
  for (const row of recent.filter(r => r.err === null && r.confirmationStatus === "finalized").slice(0, 3)) await read(row.signature, "recent", row.slot);
  const trades = (await Promise.all(records.filter(r => r.transaction).map(async r => {
    try { return (await verifiedTrades(r.transaction!, candidate.address, candidate.pool)).trades; } catch { return []; }
  }))).flat();
  const buyers = [...new Set(trades.filter(t => t.side === "buy").sort((a, b) => a.slot - b.slot || a.wallet.localeCompare(b.wallet)).map(t => t.wallet))];
  const selected = [...new Set([...roles.filter(r => r.signed).map(r => r.wallet), ...buyers])].slice(0, 3);
  for (const wallet of selected) {
    if (rpc.calls >= 16) { gaps.add("wallet_funding_history_budget_limited"); break; }
    const rows = await history(wallet, "wallet", 20);
    const firstBuy = trades.filter(t => t.wallet === wallet && t.side === "buy").sort((a, b) => a.slot - b.slot)[0];
    const limit = firstBuy?.slot ?? candidate.creation?.slot ?? Number.MAX_SAFE_INTEGER;
    const prior = rows.filter(r => r.err === null && r.confirmationStatus === "finalized" && r.slot <= limit).slice(-1)[0];
    if (prior) await read(prior.signature, "wallet", prior.slot); else gaps.add("pre_buy_funding_history_unavailable");
  }
  let holders: WalletEvidence["holders"] = null;
  if (candidate.holders?.payload_hash) {
    const saved = await db.prepare("SELECT payload FROM tenx_holder_evidence WHERE payload_hash=?1").bind(candidate.holders.payload_hash).first<{ payload: string }>();
    if (saved) holders = { analysis: candidate.holders, evidence: HolderEvidenceSchema.parse(JSON.parse(saved.payload)) };
  }
  const priorLosses = new Map<string, { tokens: Set<string>; hashes: Set<string> }>();
  const reports = await db.prepare(`SELECT payload FROM (SELECT day,payload,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at DESC,input_hash) AS position FROM tenx_reviews WHERE created_at>=?1) WHERE position=1 ORDER BY day DESC LIMIT 30`).bind(new Date(Date.now() - 30 * 86400000).toISOString()).all<{ payload: string }>();
  for (const report of reports.results.map(r => ReviewSchema.parse(JSON.parse(r.payload)))) for (const outcome of report.outcomes.filter(o => o.status === "measured" && o.outcome === "severe_loss_signal" && Date.parse(o.endpoint_at ?? "") <= Date.now())) for (const w of outcome.wallets) {
    if (![...roles.map(r => r.wallet), ...buyers].includes(w.wallet)) continue;
    const entry = priorLosses.get(w.wallet) ?? { tokens: new Set(), hashes: new Set() }; entry.tokens.add(outcome.address); entry.hashes.add(report.input_hash); priorLosses.set(w.wallet, entry);
  }
  return WalletEvidenceSchema.parse({ version: "wallet-input-v1", observed_at: new Date().toISOString(), cluster: MAINNET_GENESIS,
    asset: { address: candidate.address, pool: candidate.pool, token_program: candidate.risk.token_program, creation: candidate.creation, graduation: candidate.graduation }, records, histories, holders,
    prior_losses: [...priorLosses].slice(0, 20).map(([wallet, p]) => ({ wallet, tokens: [...p.tokens].sort().slice(0, 100), report_hashes: [...p.hashes].sort().slice(0, 30) })), gaps: [...gaps] });
}
export async function runWalletCycle(settings: WalletSettings, address?: string, now = new Date()): Promise<Record<string, unknown>> {
  const db = settings.db, at = now.toISOString(), owner = crypto.randomUUID();
  if (!settings.walletEnabled) return { state: "disabled" };
  if ((await control(db)).paused) return { state: "paused" };
  if (address) Address.parse(address);
  const rpc = new RpcClient(settings.rpcUrl, reserveWalletQuota(db, settings, now), settings.transport, 18);
  const lease = await db.prepare(`UPDATE tenx_wallet_control SET lease_owner=?1,lease_until=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<?3) AND ((?4=1 AND last_error IS NULL) OR next_refresh_at IS NULL OR next_refresh_at<=?3) RETURNING id`)
    .bind(owner, new Date(now.getTime() + 360000).toISOString(), at, address ? 1 : 0).first();
  if (!lease) return { state: "waiting" };
  let selectedAddress: string | null = null;
  try {
    const all = await candidates(db), active = shortlist(all, DEFAULT_POLICY, now);
    const attempts = await db.prepare("SELECT address,attempted_at,next_attempt_at FROM tenx_wallet_attempts").all<{ address: string; attempted_at: string; next_attempt_at: string }>();
    const tried = new Map(attempts.results.map(r => [r.address, r]));
    let candidate = address ? all.find(c => c.address === address) : active.filter(c => !tried.get(c.address) || tried.get(c.address)!.next_attempt_at <= at).sort((a, b) => (tried.get(a.address)?.attempted_at ?? "").localeCompare(tried.get(b.address)?.attempted_at ?? "") || a.address.localeCompare(b.address))[0];
    if (address && !candidate) {
      const saved = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(address).first<{ payload: string }>();
      if (saved) candidate = CandidateSchema.parse(JSON.parse(saved.payload));
    }
    if (!candidate) { await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(now.getTime() + 300000).toISOString(), owner).run(); return { state: "empty" }; }
    selectedAddress = candidate.address;
    const used = await db.prepare("SELECT used FROM tenx_wallet_usage WHERE day=?1").bind(at.slice(0, 10)).first<{ used: number }>();
    const left = Math.max(1, settings.walletDailyLimit - (used?.used ?? 0)), seconds = (Date.parse(`${new Date(now.getTime() + 86400000).toISOString().slice(0, 10)}T00:00:00Z`) - now.getTime()) / 1000;
    const spacing = Math.min(seconds + 60, Math.max(300, Math.min(7200, Math.ceil(seconds * 18 / left))));
    await db.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?1 WHERE id=1 AND lease_owner=?2").bind(new Date(now.getTime() + spacing * 1000).toISOString(), owner).run();
    const evidence = await collect(settings, candidate, rpc);
    const payload = JSON.stringify(evidence); if (new TextEncoder().encode(payload).length > 1800000) throw new Error("wallet_evidence_size_limit");
    const analysis = await analyzeWalletEvidence(evidence);
    const statements = [
      db.prepare("INSERT OR IGNORE INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?1,?2,?3,?4)").bind(analysis.evidence_hash, candidate.address, payload, analysis.observed_at),
      db.prepare("UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address=?2 AND mode='live'").bind(JSON.stringify(analysis), candidate.address),
      db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(candidate.address, at, new Date(now.getTime() + 3600000).toISOString()),
      db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_success=?1,last_address=?2,last_error=NULL WHERE id=1 AND lease_owner=?3").bind(analysis.observed_at, candidate.address, owner),
    ];
    for (const wallet of analysis.wallets) statements.push(db.prepare("INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(address,wallet) DO UPDATE SET payload_hash=excluded.payload_hash,payload=excluded.payload,observed_at=excluded.observed_at").bind(candidate.address, wallet.wallet, analysis.evidence_hash, JSON.stringify(wallet), analysis.observed_at));
    await db.batch(statements);
    const current = await db.prepare("SELECT payload FROM tenx_candidates WHERE mode='live' AND address=?1").bind(candidate.address).first<{ payload: string }>();
    if (current) await captureCohort(db, CandidateSchema.parse(JSON.parse(current.payload)), evidence.observed_at);
    return { state: "succeeded", address: candidate.address, rpc_calls: rpc.calls, evidence_hash: analysis.evidence_hash, status: analysis.status, verified_buys: analysis.metrics.verified_buys, signals: analysis.signals.map(s => s.code) };
  } catch (error) {
    const code = error instanceof SourceError ? error.code : error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message) ? error.message : "wallet_evidence_not_certified";
    const retry = error instanceof SourceError ? error.retryAfterSeconds : 300;
    await db.prepare("UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3").bind(new Date(now.getTime() + retry * 1000).toISOString(), code, owner).run();
    if (selectedAddress) await db.prepare("INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at").bind(selectedAddress, at, new Date(now.getTime() + Math.max(retry, 3600) * 1000).toISOString()).run();
    return { state: "failed", error_code: code, rpc_calls: rpc.calls };
  }
}
