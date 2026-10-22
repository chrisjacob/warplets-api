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
    const gmgn = sources.find(s => s.provider === "gmgn" && s.window === "24h") ?? sources.find(s => s.provider === "gmgn"),
      dex = sources.filter(s => s.provider === "dexscreener").sort((a,b)=>(b.token.liquidity_usd??0)-(a.token.liquidity_usd??0))[0],
      base = gmgn?.fresh ? gmgn : sources.find(s=>s.provider==="geckoterminal"&&s.fresh) ?? gmgn ?? sources.find(s => s.provider === "geckoterminal")!;
    const token = base.token, risk = gmgn?.token, marketSource = dex?.fresh ? dex : base, market=marketSource.token;
    const recentSource=marketSource.fresh&&market.volume_1h_usd!==null?marketSource:sources.find(s=>s.fresh&&s.provider==="gmgn"&&s.window==="1h"&&s.token.volume_1h_usd!==null);
    const reasons = [], adverse = risk?.wash_flag === true || risk?.honeypot === true || token.chain === "solana" && (risk?.mint_disabled === false || risk?.freeze_disabled === false);
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
    if (market.liquidity_usd === null || market.liquidity_usd < 10000) reasons.push("liquidity_low_or_unknown");
    if (!recentSource) reasons.push("recent_trading_unknown");
    if (market.buys === null || market.sells === null || market.buys === 0 || market.sells === 0) reasons.push("two_sided_trading_unresolved");
    if (dex?.token.boost_count && dex.token.boost_count > 0) reasons.push("paid_dex_boost_present");
    reasons.push("meme_relevance_unreviewed", "organic_participation_unverified", "launch_checks_separate");
    rows.push({ ...token, image_url: token.image_url ?? dex?.token.image_url ?? sources.find(s=>s.token.image_url)?.token.image_url ?? null,
      market_cap_usd: market.market_cap_usd, fdv_usd: market.fdv_usd, liquidity_usd: market.liquidity_usd,
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
export async function readAttentionQueue(db: D1Database, now = new Date()) {
  const since = new Date(now.getTime()-86400000).toISOString();
  const selected = await db.prepare(`SELECT id,bytes,state FROM tenx_source_reservations WHERE day>=?1 AND reserved_at>=?2 AND reserved_at<=?3
    AND json_extract(request,'$.kind') IN ('gmgn_hot_searches','geckoterminal_global_trending','attention_dex_crosscheck')
    ORDER BY reserved_at DESC,id DESC LIMIT 49`).bind(since.slice(0,10),since,now.toISOString()).all<{id:string;bytes:number;state:string}>();
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
  return AttentionQueue.parse({...result,history_truncated:result.history_truncated||selected.results.length>48||gaps.includes("receipt_read_byte_bound"),gaps:[...new Set([...gaps,"completed_launch_registry_not_connected"])]});
}
