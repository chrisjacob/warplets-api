import { z } from "zod";
import { SignatureRows, type RpcClient } from "./rpc";
import { validAddress, hashJson } from "./solana";
import {WalletTransactionSchema, keys, type WalletTransaction} from "./wallet-rpc";
import {validWalletTransaction} from "./wallet-trades";

const Key = z.string().refine(validAddress), Sig = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
export const FundingAnchorSchema = z.object({ wallet: Key, signature: Sig, slot: z.number().int().safe().nonnegative(), block_time: z.string().datetime(), kind: z.enum(["sampled_buy", "signed_creation", "funding_transfer"]), instruction_index: z.number().int().nonnegative().optional() }).strict();
export type FundingAnchor = z.infer<typeof FundingAnchorSchema>;
export const FundingScanSchema = z.object({
  wallet: Key, anchor: FundingAnchorSchema, lookback_seconds: z.literal(3600),
  pages: z.array(z.object({ before: Sig, fetched_at: z.string().datetime(), rows: SignatureRows.max(50) }).strict()).max(3),
  examined: z.array(z.object({ signature: Sig, status: z.enum(["available", "missing", "unsupported"]) }).strict()).max(12),
  attempted_at: z.string().datetime(),
}).strict();
export type FundingScan = z.infer<typeof FundingScanSchema>;
export function fundingRows(scan: FundingScan) {
  const start = Date.parse(scan.anchor.block_time) / 1000 - scan.lookback_seconds;
  return scan.pages.flatMap(p => p.rows).filter(r => r.err === null && r.confirmationStatus === "finalized" && r.slot <= scan.anchor.slot && (r.blockTime === null || r.blockTime >= start));
}
export function fundingCoverage(scan: FundingScan, available: Set<string>) {
  const gaps: string[] = [], rows = scan.pages.flatMap(p => p.rows), seen = new Set<string>();
  let before = scan.anchor.signature, previousSlot = scan.anchor.slot;
  for (const page of scan.pages) {
    if (page.before !== before) throw new Error("funding_cursor_chain_mismatch");
    for (const row of page.rows) {
      if (seen.has(row.signature) || row.signature === scan.anchor.signature || row.slot > previousSlot || row.blockTime !== null && row.blockTime * 1000 > Date.parse(scan.anchor.block_time)) throw new Error("funding_page_order_mismatch");
      seen.add(row.signature); previousSlot = row.slot;
    }
    before = page.rows.at(-1)?.signature ?? before;
  }
  const start = Date.parse(scan.anchor.block_time) / 1000 - 3600;
  const boundary = rows.some(r => r.blockTime !== null && r.blockTime < start);
  const end = scan.pages.at(-1)?.rows.length === 0;
  const wanted = fundingRows(scan), examined = new Map(scan.examined.map(r => [r.signature, r.status]));
  if (examined.size !== scan.examined.length || scan.examined.some(r => !wanted.some(w => w.signature === r.signature))) throw new Error("funding_examined_reference_mismatch");
  const decoded = wanted.filter(r => examined.get(r.signature) === "available" && available.has(r.signature)).length;
  if (!boundary) gaps.push(end ? "provider_history_ended_before_window_boundary" : scan.pages.length === 3 ? "funding_page_limit" : "funding_paging_pending");
  if (rows.some(r => r.blockTime === null)) gaps.push("funding_signature_time_unknown");
  if (rows.some(r => r.err === null && r.confirmationStatus !== "finalized")) gaps.push("funding_signature_not_finalized");
  if (wanted.some(r => !examined.has(r.signature))) gaps.push(scan.examined.length === 12 ? "funding_transaction_limit" : "funding_transactions_pending");
  if (scan.examined.some(r => r.status !== "available" || !available.has(r.signature))) gaps.push("funding_transaction_missing_or_unsupported");
  return { wallet: scan.wallet, anchor_signature: scan.anchor.signature, anchor_kind: scan.anchor.kind, anchor_at: scan.anchor.block_time, window_start: new Date(Date.parse(scan.anchor.block_time) - 3600000).toISOString(), pages: scan.pages.length, signatures: rows.length, transactions_in_window: wanted.length, transactions_examined: decoded,
    status: gaps.length ? "partial" as const : "window_examined" as const, boundary_reached: boundary, gaps };
}

type Read = (signature: string, slot: number, status?: "missing" | "unsupported") => Promise<{ transaction: WalletTransaction | null; status: "available" | "missing" | "unsupported" } | null>;
// Scheduling only: preserve the historical coverage decoder and its hashes.
// An oversized window cannot pass the unchanged twelve-body evidence bound.
export function fundingTask(scan: FundingScan) {
  const coverage = fundingCoverage(scan, new Set(scan.examined.filter(e => e.status === "available").map(e => e.signature)));
  const pending = fundingRows(scan).filter(r => !scan.examined.some(e => e.signature === r.signature));
  const gaps = [...coverage.gaps, ...(fundingRows(scan).length > 12 ? ["funding_window_exceeds_transaction_bound"] : [])];
  const blocked = gaps.some(g => ["provider_history_ended_before_window_boundary", "funding_page_limit", "funding_transaction_limit", "funding_window_exceeds_transaction_bound", "funding_transaction_missing_or_unsupported", "funding_signature_time_unknown", "funding_signature_not_finalized"].includes(g));
  return { coverage, pending, gaps, blocked };
}
// Cache-only projection. A prior missing/unsupported observation is never a
// reason to purchase another body. Reuse requires exact saved finalized rows.
export async function recoverCachedFunding(db:D1Database,input:FundingScan[],now=new Date(),directWalletLimit:8|20=8){
  if(input.length>directWalletLimit)throw new Error("funding_wallet_limit");
  const scans=structuredClone(input),records:{signature:string;transaction:WalletTransaction;status:"available";fetched_at:string}[]=[],recovered:{scan:number;signature:string;previous_status:"missing"|"unsupported"}[]=[];
  const cached=new Map<string,{payload:string;payload_hash:string;fetched_at:string}|null>();let bytes=0;
  for(const [index,scan] of scans.entries()){
    const task=fundingTask(scan);
    if(Date.parse(scan.attempted_at)>now.getTime()||Date.parse(scan.anchor.block_time)>now.getTime()||scan.pages.some(p=>Date.parse(p.fetched_at)>now.getTime()))throw new Error("funding_checkpoint_from_future");
    // Cache availability cannot repair missing boundaries or excessive windows.
    if(task.gaps.some(g=>["provider_history_ended_before_window_boundary","funding_page_limit","funding_transaction_limit","funding_window_exceeds_transaction_bound","funding_signature_time_unknown","funding_signature_not_finalized"].includes(g)))continue;
    for(const entry of scan.examined.filter(e=>e.status!=="available")){
      if(!cached.has(entry.signature)){
        // Absent early references must not starve a reusable later window.
        // Wider v5 scopes share the same 96-lookup cache ceiling. Existing
        // global record and byte bounds cap materialized bodies independently.
        if(cached.size>=96||records.length>=64)continue;
        cached.set(entry.signature,await db.prepare("SELECT payload,payload_hash,fetched_at FROM tenx_wallet_transactions WHERE signature=?1").bind(entry.signature).first<{payload:string;payload_hash:string;fetched_at:string}>());
      }
      const saved=cached.get(entry.signature);if(!saved)continue;
      const size=new TextEncoder().encode(saved.payload).length;
      if(size>250000)throw new Error("wallet_transaction_too_large");
      if(!records.some(r=>r.signature===entry.signature)&&bytes+size>900000){cached.set(entry.signature,null);continue;}
      const tx=WalletTransactionSchema.parse(JSON.parse(saved.payload)),row=fundingRows(scan).find(r=>r.signature===entry.signature)!;
      if(await hashJson(tx)!==saved.payload_hash||tx.transaction.signatures[0]!==entry.signature||tx.slot!==row.slot)throw new Error("wallet_cache_hash_or_identity_mismatch");
      validWalletTransaction(tx);
      if(!keys(tx).includes(scan.wallet))throw new Error("funding_wallet_not_referenced");
      if(!Number.isFinite(Date.parse(saved.fetched_at))||Date.parse(saved.fetched_at)>now.getTime()||row.blockTime===null||tx.blockTime!==row.blockTime||tx.blockTime*1000>now.getTime())throw new Error("wallet_cache_time_mismatch");
      if(!records.some(r=>r.signature===entry.signature)){
        bytes+=size;
        records.push({signature:entry.signature,transaction:tx,status:"available",fetched_at:saved.fetched_at});
      }
      recovered.push({scan:index,signature:entry.signature,previous_status:entry.status as "missing"|"unsupported"});entry.status="available";
    }
  }
  return {scans,records,recovered};
}
export async function loadFundingCheckpoints(db: D1Database, address: string, anchors: FundingAnchor[], secondHop = false,directWalletLimit:8|20=8): Promise<FundingScan[]> {
  const scans: FundingScan[] = [], table = secondHop ? "tenx_second_hop_scans" : "tenx_funding_scans";
  for (const anchor of anchors.slice(0, secondHop ? 4 : directWalletLimit)) {
    const anchorKey = secondHop ? `${anchor.signature}:${anchor.instruction_index}` : anchor.signature;
    let saved = await db.prepare(`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`).bind(address,anchor.wallet,anchorKey).first<{payload:string;payload_hash:string}>();
    if (!saved && secondHop) {
      const previous = await db.prepare(`SELECT payload,payload_hash FROM ${table} WHERE address=?1 AND wallet=?2 AND anchor_signature=?3`).bind(address,anchor.wallet,anchor.signature).first<{payload:string;payload_hash:string}>();
      if (previous) {
        const parsed = FundingScanSchema.parse(JSON.parse(previous.payload));
        if (await hashJson(parsed) !== previous.payload_hash) throw new Error("funding_progress_hash_mismatch");
        if (await hashJson(parsed.anchor) === await hashJson(anchor)) saved = previous;
      }
    }
    const scan = saved ? FundingScanSchema.parse(JSON.parse(saved.payload)) : FundingScanSchema.parse({wallet:anchor.wallet,anchor,lookback_seconds:3600,pages:[],examined:[],attempted_at:"1970-01-01T00:00:00.000Z"});
    if (scan.wallet !== anchor.wallet || saved && (await hashJson(scan) !== saved.payload_hash || await hashJson(scan.anchor) !== await hashJson(anchor))) throw new Error("funding_progress_hash_mismatch");
    fundingTask(scan); scans.push(scan);
  }
  return scans;
}
export async function collectFundingHistories(db: D1Database, rpc: RpcClient, address: string, anchors: FundingAnchor[], read: Read, options: { secondHop?: boolean; rpcCeiling?: number; cacheRecovery?:boolean;directWalletLimit?:8|20 } = {}): Promise<FundingScan[]> {
  const original = await loadFundingCheckpoints(db,address,anchors,options.secondHop,options.directWalletLimit);
  const recovery=options.cacheRecovery?await recoverCachedFunding(db,original,new Date(),options.directWalletLimit):{scans:original,records:[],recovered:[]};
  const scans=recovery.scans;
  const table = options.secondHop ? "tenx_second_hop_scans" : "tenx_funding_scans", ceiling = Math.min(18, options.rpcCeiling ?? 18);
  // Second-hop progress belongs to an exact outflow instruction. Additional
  // discovered recipients can reveal an earlier outflow in the same transaction.
  const anchorKey = (anchor: FundingAnchor) => options.secondHop ? `${anchor.signature}:${anchor.instruction_index}` : anchor.signature;
  async function persist(scan: FundingScan) {
    scan.attempted_at = new Date().toISOString();
    const normalized = FundingScanSchema.parse(scan), payload = JSON.stringify(normalized), hash = await hashJson(normalized);
    await db.prepare(`INSERT INTO ${table}(address,wallet,anchor_signature,payload,payload_hash,attempted_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(address,wallet,anchor_signature) DO UPDATE SET payload=excluded.payload,payload_hash=excluded.payload_hash,attempted_at=excluded.attempted_at`).bind(address, scan.wallet, anchorKey(scan.anchor), payload, hash, scan.attempted_at).run();
  }
  for (const [index,scan] of scans.entries()) {
    // Bring earlier read-only results into this replayable evidence snapshot.
    for (const record of scan.examined){
      const result=await read(record.signature, fundingRows(scan).find(r => r.signature === record.signature)!.slot, record.status === "available" ? undefined : record.status);
      const promotion=recovery.recovered.find(r=>r.scan===index&&r.signature===record.signature);
      if(promotion&&(!result?.transaction||result.status!=="available"))record.status=promotion.previous_status;
      else if(promotion&&await hashJson(result!.transaction)!==await hashJson(recovery.records.find(r=>r.signature===record.signature)!.transaction))throw new Error("funding_recovery_body_changed");
    }
    if(await hashJson(scan)!==await hashJson(original[index]!)){
      // A concurrent checkpoint advance cannot be overwritten by this repair.
      scan.attempted_at=new Date().toISOString();
      const normalized=FundingScanSchema.parse(scan),hash=await hashJson(normalized);
      const key=await db.prepare(`SELECT anchor_signature FROM ${table} WHERE address=? AND wallet=? AND anchor_signature IN (?,?) ORDER BY CASE WHEN anchor_signature=? THEN 0 ELSE 1 END LIMIT 1`)
        .bind(address,scan.wallet,anchorKey(scan.anchor),options.secondHop?scan.anchor.signature:anchorKey(scan.anchor),anchorKey(scan.anchor)).first<{anchor_signature:string}>();
      const saved=await db.prepare(`UPDATE ${table} SET payload=?,payload_hash=?,attempted_at=? WHERE address=? AND wallet=? AND anchor_signature=? AND payload_hash=?`)
        .bind(JSON.stringify(normalized),hash,scan.attempted_at,address,scan.wallet,key?.anchor_signature??anchorKey(scan.anchor),await hashJson(original[index]!)).run();
      if(saved.meta.changes!==1)throw new Error("funding_checkpoint_changed_during_cache_recovery");
    }
  }
  const pending = scans.filter(scan => {
    const task = fundingTask(scan);
    return !task.blocked && (task.coverage.gaps.includes("funding_paging_pending") || task.pending.length > 0);
  }).sort((a,b) => Number(!fundingTask(a).coverage.boundary_reached)-Number(!fundingTask(b).coverage.boundary_reached) || fundingTask(a).pending.length-fundingTask(b).pending.length || a.attempted_at.localeCompare(b.attempted_at) || a.wallet.localeCompare(b.wallet));
  for (const scan of pending.slice(0, options.secondHop ? 1 : 3)) {
    if (rpc.calls >= ceiling - 1) break;
    const before = scan.pages.at(-1)?.rows.at(-1)?.signature ?? scan.anchor.signature;
    const coverage = fundingCoverage(scan, new Set(scan.examined.filter(e => e.status === "available").map(e => e.signature)));
    // Drain decoded work before adding another page of references.
    if (coverage.gaps.includes("funding_paging_pending") && !fundingRows(scan).some(r => !scan.examined.some(e => e.signature === r.signature))) {
      const rows = await rpc.signatures(scan.wallet, 50, before);
      scan.pages.push({ before, rows, fetched_at: new Date().toISOString() });
      fundingCoverage(scan, new Set(scan.examined.filter(e => e.status === "available").map(e => e.signature)));
      await persist(scan);
    }
    if (fundingTask(scan).blocked) continue;
    let reads = 0;
    for (const row of fundingRows(scan)) {
      if (scan.examined.some(e => e.signature === row.signature)) continue;
      if (++reads > 3 || scan.examined.length >= 12 || rpc.calls >= ceiling) break;
      const result = await read(row.signature, row.slot);
      if (result) { scan.examined.push({ signature: row.signature, status: result.status }); await persist(scan); }
    }
    await persist(scan);
  }
  return scans;
}
