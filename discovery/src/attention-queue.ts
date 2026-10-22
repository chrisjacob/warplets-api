import { z } from "zod";
import { AttentionChain, AttentionObservation, AttentionRequest, AttentionToken, attentionAddress, normalizeAttention, type AttentionSnapshot } from "./attention-feed-contract";
import { executeShortlistQuery } from "./shortlist-query";
import { readSourceReceiptWithRequest, type SourceFetcher } from "./source-collection-transport";
import type { GmgnSettings } from "./gmgn";
import { AttentionSource, AttentionQueue, type AttentionQueueResult } from "./attention-queue-model";
type SourceRow = z.infer<typeof AttentionSource> & { token: z.infer<typeof AttentionToken> };
// Chain + contract is identity. A symbol is never a join key; pools are not votes.
export function buildAttentionQueue(rawSnapshots: AttentionSnapshot[], now = new Date(), completedLaunches: {chain: z.infer<typeof AttentionChain>;address:string}[] = []): AttentionQueueResult {
  const snapshots = rawSnapshots.map(s => AttentionObservation.parse(s));
  const at = now.getTime(), oldest = at - 86400000, freshAfter = at - 7200000, groups = new Map<string, SourceRow[]>(), hours = new Map<string, Set<string>>();
  for (const snapshot of snapshots.sort((a,b) => b.received_at.localeCompare(a.received_at))) {
    const time = Date.parse(snapshot.received_at); if (time > at || time < oldest) continue;
    for (const token of snapshot.rows) {
      const key = `${token.chain}:${token.address}`, group = groups.get(key) ?? [], identity = `${snapshot.provider}:${token.window}`;
      const existing = group.find(s => `${s.provider}:${s.window}` === identity);
      if (existing) {
        if(snapshot.provider==="dexscreener" && existing.received_at===snapshot.received_at && (token.liquidity_usd??0)>(existing.token.liquidity_usd??0))existing.token=token;
        // Compare equal windows across distinct observed hours. Do not subtract
        // overlapping rolling visit counts and call that hourly unique searches.
        if (existing.previous_rank === null && existing.received_at.slice(0,13) !== snapshot.received_at.slice(0,13)) existing.previous_rank = token.provider_rank;
      } else group.push({ provider: snapshot.provider, window: token.window, received_at: snapshot.received_at, rank: token.provider_rank,
        previous_rank: null, search_interest: token.search_interest, fresh: time >= freshAfter, token });
      groups.set(key, group);
      if (snapshot.provider !== "dexscreener") { const observed = hours.get(key) ?? new Set<string>(); observed.add(snapshot.received_at.slice(0,13)); hours.set(key, observed); }
    }
  }
  const excluded = new Set(completedLaunches.map(l => { const address=attentionAddress(l.chain,l.address); if(!address)throw Error("invalid_completed_launch_identity"); return `${l.chain}:${address}`; }));
  let excludedLaunched = 0;
  const rows: AttentionQueueResult["rows"] = [];
  for (const [identity, sources] of groups) {
    if (!sources.some(s => s.provider !== "dexscreener")) continue;
    if (excluded.has(identity)) { excludedLaunched++; continue; }
    const gmgn = sources.find(s => s.provider === "gmgn" && s.window === "24h" && s.fresh) ?? sources.find(s => s.provider === "gmgn" && s.fresh) ?? sources.find(s => s.provider === "gmgn"),
      dex = sources.filter(s => s.provider === "dexscreener").sort((a,b)=>(b.token.liquidity_usd??0)-(a.token.liquidity_usd??0))[0],
      base = gmgn?.fresh ? gmgn : sources.find(s=>s.provider==="geckoterminal"&&s.fresh) ?? gmgn ?? sources.find(s => s.provider === "geckoterminal")!;
    const token = base.token, risk = gmgn?.token, marketSource = dex?.fresh ? dex : base, market=marketSource.token;
    const recentSource=marketSource.fresh&&market.volume_1h_usd!==null?marketSource:sources.find(s=>s.fresh&&s.provider==="gmgn"&&s.window==="1h"&&s.token.volume_1h_usd!==null);
    const reasons = [], adverse = sources.some(s=>s.provider==="gmgn"&&(s.token.wash_flag===true||s.token.honeypot===true||token.chain==="solana"&&(s.token.mint_disabled===false||s.token.freeze_disabled===false)));
    const families = new Set(sources.filter(s => s.provider !== "dexscreener" && s.fresh).map(s => s.provider));
    if (!families.size) reasons.push("attention_observations_stale");
    if (adverse) reasons.push("provider_adverse_security_flag");
    if (!gmgn || !gmgn.fresh) reasons.push("security_observation_missing_or_stale");
    if (!risk || risk.wash_flag === null) reasons.push("wash_status_unknown");
    if (token.chain === "solana" && (!risk || risk.mint_disabled === null || risk.freeze_disabled === null)) reasons.push("mint_freeze_status_unknown");
    if (token.chain !== "solana" && (!risk || risk.honeypot === null)) reasons.push("honeypot_status_unknown");
    if ([risk?.top10_ratio, risk?.insider_ratio, risk?.bundler_ratio].some(r => r === null || r === undefined)) reasons.push("concentration_fields_incomplete");
    if ((risk?.top10_ratio ?? 0) >= .5 || (risk?.insider_ratio ?? 0) >= .3 || (risk?.bundler_ratio ?? 0) >= .5) reasons.push("concentration_requires_review");
    if (!dex?.fresh) reasons.push("fresh_market_crosscheck_needed");
    // These are differences between attributed snapshots, not scam verdicts.
    // Pool coverage, supply estimates and ordinary price movement can differ.
    if (dex?.fresh) for (const field of ["market_cap_usd", "liquidity_usd"] as const) {
      const value = dex.token[field];
      if (value !== null && sources.some(s => s.fresh && s.provider !== "dexscreener" && s.token[field] !== null &&
        Math.max(value, s.token[field]!) > 0 && Math.min(value, s.token[field]!) * 2 <= Math.max(value, s.token[field]!))) reasons.push(`${field}_source_disagreement`);
    }
    if (market.liquidity_usd === null || market.liquidity_usd < 10000) reasons.push("liquidity_low_or_unknown");
    if (!recentSource) reasons.push("recent_trading_unknown");
    if (market.buys === null || market.sells === null || market.buys === 0 || market.sells === 0) reasons.push("two_sided_trading_unresolved");
    if (dex?.token.boost_count && dex.token.boost_count > 0) reasons.push("paid_dex_boost_present");
    reasons.push("meme_relevance_unreviewed", "organic_participation_unverified", "launch_checks_separate");
    rows.push({ ...token, image_url: token.image_url ?? dex?.token.image_url ?? sources.find(s=>s.token.image_url)?.token.image_url ?? null,
      market_cap_usd: market.market_cap_usd, fdv_usd: market.fdv_usd, liquidity_usd: market.liquidity_usd, buys:market.buys, sells:market.sells,
      volume_24h_usd: market.volume_24h_usd, volume_1h_usd: recentSource?.token.volume_1h_usd??null, boost_count: dex?.token.boost_count ?? null,
      market_source:marketSource.provider,recent_volume_source:recentSource?.provider??null,
      sources: sources.map(({token: _token,...source}) => source), attention_families: families.size, observed_hours: hours.get(identity)?.size ?? 0,
      checks: adverse ? "adverse" : "review", reasons, market_crosschecked: !!dex?.fresh });
  }
  const heat = (row: typeof rows[number]) => row.sources.find(s => s.provider === "gmgn" && s.window === "24h" && s.fresh)?.search_interest ?? -1;
  const rank = (row: typeof rows[number]) => Math.min(...row.sources.filter(s=>s.provider!=="dexscreener"&&s.fresh).map(s=>s.rank??100000),100000);
  rows.sort((a,b) => Number(a.checks==="adverse")-Number(b.checks==="adverse") || b.attention_families-a.attention_families || heat(b)-heat(a) || rank(a)-rank(b) || `${a.chain}:${a.address}`.localeCompare(`${b.chain}:${b.address}`));
  return AttentionQueue.parse({ version: "attention-queue-v1", as_of: now.toISOString(), rows: rows.slice(0,100), observed_tokens: rows.length, returned_tokens: Math.min(100,rows.length),
    excluded_launched: excludedLaunched, snapshot_count: snapshots.length, history_truncated: rows.length > 100, gaps: [], provider_requests: 0, database_writes: 0,
    launch_history_connected: false, launch_enabled: false, scoring_effect: "none", evidence_gates_changed: false });
}
// Fixed hourly reservations persist in the existing receipt store. Failure is
// charged and not reissued in that hour; no separate quota or migration exists.
export async function collectAttention(settings: GmgnSettings, raw: unknown, fetcher: SourceFetcher, clock = () => new Date()) {
  const input = z.object({ source: z.enum(["gmgn", "geckoterminal"]), reason: z.string().min(3).max(300) }).strict().parse(raw);
  const request = AttentionRequest.parse(input.source === "gmgn" ? {kind:"gmgn_hot_searches"} : {kind:"geckoterminal_global_trending"});
  const hour=clock().toISOString().slice(0,13).replace(/[^0-9]/g,"");
  const id=`attention-${input.source}-${hour}`;
  if(await settings.db.prepare("SELECT id FROM tenx_source_reservations WHERE id=?1").bind(id).first())return{state:"held",reason:"source_hour_already_reserved",provider_requests:0};
  return executeShortlistQuery(settings,id,request,fetcher,clock);
}
export async function readAttentionQueue(db: D1Database, now = new Date(), scope:"display"|"review"="display") {
  const since = new Date(now.getTime()-86400000).toISOString();
  // A collecting turn also needs the original reservation/lease/receipt SQL.
  // Leave room for that work instead of spending the display's full read budget.
  const attentionLimit=scope==="review"?16:40, marketLimit=scope==="review"?4:8;
  // Keep both attention history and market corroboration within the original
  // 48-receipt/8MB bound. Market receipts must not evict every discovery list.
  const selected = await db.prepare(`WITH ranked AS (SELECT id,bytes,state,
    json_extract(request,'$.kind')='attention_dex_crosscheck' AS market,
    ROW_NUMBER() OVER (PARTITION BY json_extract(request,'$.kind')='attention_dex_crosscheck' ORDER BY reserved_at DESC,id DESC) AS position,
    COUNT(*) OVER (PARTITION BY json_extract(request,'$.kind')='attention_dex_crosscheck') AS total, reserved_at
    FROM tenx_source_reservations WHERE day>=?1 AND reserved_at>=?2 AND reserved_at<=?3
    AND json_extract(request,'$.kind') IN ('gmgn_hot_searches','geckoterminal_global_trending','attention_dex_crosscheck')
    ) SELECT id,bytes,state,market,total FROM ranked WHERE position<=CASE WHEN market THEN ?5 ELSE ?4 END
    ORDER BY reserved_at DESC,id DESC`).bind(since.slice(0,10),since,now.toISOString(),attentionLimit,marketLimit).all<{id:string;bytes:number;state:string;market:number;total:number}>();
  const snapshots: AttentionSnapshot[] = [], gaps: string[] = []; let bytes=0;
  for (const row of selected.results.slice(0,48)) {
    if(row.state!=="succeeded"){gaps.push("collection_attempt_not_successful");continue;}
    if(bytes+row.bytes>8000000){gaps.push("receipt_read_byte_bound");break;}
    bytes+=row.bytes;
    try { const saved=await readSourceReceiptWithRequest(db,row.id); if(!saved||saved.receipt.error!==null)throw Error("receipt_unusable");
      snapshots.push(normalizeAttention(saved.request,saved.receipt.response,saved.receipt.received_at));
    }catch{gaps.push("receipt_replay_or_schema_failed");}
  }
  const result=buildAttentionQueue(snapshots,now);
  return AttentionQueue.parse({...result,history_truncated:result.history_truncated||selected.results.some(r=>r.total>(r.market?marketLimit:attentionLimit))||gaps.includes("receipt_read_byte_bound"),gaps:[...new Set([...gaps,"completed_launch_registry_not_connected"])]});
}

export function attentionReviewRequest(queue: AttentionQueueResult) {
  const pending=queue.rows.filter(r=>r.checks!=="adverse"&&r.attention_families>0).slice(0,20).filter(r=>!r.market_crosschecked);
  const chain=pending[0]?.chain;
  return chain ? AttentionRequest.parse({kind:"attention_dex_crosscheck",chain,addresses:pending.filter(r=>r.chain===chain).map(r=>r.address)}) : null;
}

// One bounded batch total per UTC hour, not one per token or one per browser.
// IDs remain spent after an empty/failed result. Admission holds are unspent.
export async function reviewAttention(settings:GmgnSettings, raw:unknown, fetcher:SourceFetcher, clock=()=>new Date()) {
  z.object({reason:z.string().min(3).max(300)}).strict().parse(raw);
  const at=clock(),id=`attention-review-${at.toISOString().slice(0,13).replace(/[^0-9]/g,"")}`;
  if(await settings.db.prepare("SELECT id FROM tenx_source_reservations WHERE id=?1").bind(id).first())return{state:"held",reason:"review_hour_already_reserved",provider_requests:0};
  const queue=await readAttentionQueue(settings.db,at,"review"),request=attentionReviewRequest(queue);
  if(!request)return{state:"held",reason:"no_fresh_shortlist_needing_crosscheck",provider_requests:0};
  return {...await executeShortlistQuery(settings,id,request,fetcher,clock),selection_history_truncated:queue.history_truncated};
}
