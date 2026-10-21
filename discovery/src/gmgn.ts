import { z } from "zod";
import { GmgnRequestSchema, gmgnCandlePart } from "./gmgn-request";
import { normalizeGmgn } from "./gmgn-normalize";
import { reserveSourceFetch, sharedResearchUsage, SOURCE_COLLECTION_LIMITS as L } from "./source-collection-store";
import { executeReservedSource, readSourceReceipt, type SourceFetcher } from "./source-collection-transport";
import { GMGN_USE_AUTHORITY, GmgnPublicSummarySchema } from "./gmgn-model";
import { Address } from "./model";
import { GmgnRequest, gmgnDescriptor } from "./gmgn-request";
import { researchLimits, type ResearchMode } from "./research-limits";
import { assembleGmgnWindow } from "./gmgn-window";
import { hashJson } from "./solana";
import { GmgnTraderSampleSchema } from "./gmgn-traders";
import {GmgnWalletActivitySchema} from "./gmgn-wallet-activity";
import {gmgnActivitySelection} from "./gmgn-activity-selection";
import {freezeGmgnDailyCohort,readGmgnDailyCohort} from "./gmgn-rotation";

export const GmgnReviewRequestSchema = z.object({ reason: z.string().min(3).max(300), request_id: z.uuid(),
  mode: z.enum(["access_probe", "retained_research"]), request: GmgnRequestSchema }).strict();
export interface GmgnSettings { db: D1Database; apiKey?: string; permissionReference?: string; marketDailyLimit: number; researchMode?: ResearchMode }
const configured = (key?: string) => /^[\x21-\x7e]{8,512}$/.test(key ?? "");
const permitted = (reference?: string) => reference === GMGN_USE_AUTHORITY;

export async function gmgnStatus(settings: GmgnSettings, now = new Date()) {
  const latest = await settings.db.prepare(`SELECT id,state,reserved_at FROM tenx_source_reservations
    WHERE day>=?1 AND json_extract(request,'$.kind') LIKE 'gmgn_%' ORDER BY reserved_at DESC,id DESC LIMIT 1`)
    .bind(new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)).first();
  const transport = await settings.db.prepare("SELECT next_at,backoff_until FROM tenx_source_transport_control WHERE id=1").first();
  const rotation=await readGmgnDailyCohort(settings.db,now.toISOString().slice(0,10));
  return { version: "gmgn-readiness-v1", key_configured: configured(settings.apiKey),
    retained_research_permitted: permitted(settings.permissionReference), public_display_authority: permitted(settings.permissionReference) ? GMGN_USE_AUTHORITY : null,
    provider_rights_independently_confirmed: false,
    access_verified: "inspect_latest_probe_receipt", latest, transport, cache_lookback_days: 7,
    shared_research: await sharedResearchUsage(settings.db, now.toISOString().slice(0, 10)),
    research_limits: researchLimits(settings.researchMode),
    limits: { daily_http_subset: researchLimits(settings.researchMode).source_daily_requests, shared_market_maximum: L.market_daily_maximum, maximum_weight_per_request: 5,
      maximum_daily_weight: Math.min(researchLimits(settings.researchMode).source_daily_requests ?? L.market_daily_maximum, L.market_daily_maximum, settings.marketDailyLimit) * 5, minimum_spacing_seconds: L.spacing_ms / 1000, subset_is_additional: false },
    daily_rotation:rotation,scheduled_collection: "existing_maintenance_spare_capture", scoring_effect: "none", evidence_gates_changed: false, provider_requests: 0, database_writes: 0 };
}

// Redistribute the existing 21 endpoint attempts/day; no additional allowance.
// The frozen daily manifest is separate from immutable first-grade score cohorts.
export async function gmgnPilotHasCapacity(settings: GmgnSettings, now = new Date()) {
  if (!configured(settings.apiKey) || !permitted(settings.permissionReference)) return false;
  const at = now.toISOString(), day = at.slice(0, 10), usage = await sharedResearchUsage(settings.db, day);
  const limits = researchLimits(settings.researchMode);
  if (!usage || limits.daily_records !== null && usage.records >= limits.daily_records || limits.daily_bytes !== null && usage.bytes + L.reserved_bytes > limits.daily_bytes) return false;
  const row = await settings.db.prepare(`SELECT
    (SELECT count(*) FROM tenx_source_reservations WHERE day=?1) AS used,
    (SELECT used FROM tenx_usage WHERE provider='market' AND day=?1) AS market_used,
    (SELECT count(*) FROM tenx_source_reservations
      WHERE day=?1 AND json_extract(request,'$.kind') IN
      ('gmgn_token_info','gmgn_token_security','gmgn_token_pool','gmgn_token_candles')) AS attempted,
    EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?2)) AS active,
    EXISTS(SELECT 1 FROM tenx_source_transport_control WHERE id=1 AND (next_at IS NULL OR next_at<=?2) AND (backoff_until IS NULL OR backoff_until<=?2)) AS paced,
    EXISTS(SELECT 1 FROM tenx_market_control WHERE id=1 AND last_error IS NOT NULL AND next_refresh_at>?2) AS market_backoff,
    EXISTS(SELECT 1 FROM tenx_source_reservations WHERE state IN ('reserved','fetching') AND lease_until>?2) AS in_flight`)
    .bind(day, at).first<{used:number;market_used:number|null;attempted:number;active:number;paced:number;market_backoff:number;in_flight:number}>();
  const cohort=await readGmgnDailyCohort(settings.db,day);
  if(cohort&&!cohort.manifest.selected.length)return false;
  if(cohort){
    const seriesIds=await Promise.all(cohort.manifest.selected.map(address=>gmgnStableId(day+":"+address+":rotation-window-v1")));
    const done=await settings.db.prepare(`SELECT count(DISTINCT json_extract(request,'$.address')||':'||json_extract(request,'$.kind')||':'||COALESCE(json_extract(request,'$.series.part'),-1)) AS n
      FROM tenx_source_reservations WHERE day=?1 AND json_extract(request,'$.address') IN (SELECT value FROM json_each(?2))
      AND (json_extract(request,'$.kind') IN ('gmgn_token_info','gmgn_token_security','gmgn_token_pool') OR (json_extract(request,'$.kind')='gmgn_token_candles' AND json_extract(request,'$.series.id') IN (SELECT value FROM json_each(?3))))`)
      .bind(day,JSON.stringify(cohort.manifest.selected),JSON.stringify(seriesIds)).first<{n:number}>();
    if((done?.n??0)>=cohort.manifest.selected.length*7)return false;
  }
  return Boolean(row && (limits.source_daily_requests === null || row.used < limits.source_daily_requests) && (row.market_used ?? 0) < Math.min(L.market_daily_maximum, settings.marketDailyLimit)
    && row.attempted < 21 && row.active && row.paced && !row.market_backoff && !row.in_flight);
}
async function gmgnStableId(value: string) {
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;
  const h=[...bytes.slice(0,16)].map(v=>v.toString(16).padStart(2,"0")).join("");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
}
export async function runGmgnPilot(settings: GmgnSettings, scoreAttempts: number, fetcher: SourceFetcher, clock = () => new Date()) {
  if (!configured(settings.apiKey) || !permitted(settings.permissionReference) || !Number.isInteger(scoreAttempts) || scoreAttempts < 0 || scoreAttempts >= 3)
    return { state: "held", reason: "no_configured_spare_capture", provider_requests: 0 };
  const at = clock(), day = at.toISOString().slice(0, 10);
  if(!await gmgnPilotHasCapacity(settings,at))return {state:"held",reason:"shared_capacity_or_daily_rotation_exhausted",provider_requests:0};
  const {manifest}=await freezeGmgnDailyCohort(settings.db,at);
  for (const kind of ["gmgn_token_info", "gmgn_token_security", "gmgn_token_pool", "gmgn_token_candles"] as const) for (const address of manifest.selected) {
    let request: GmgnRequest;
    if (kind === "gmgn_token_candles") {
      const root = { id: await gmgnStableId(day+":"+address+":rotation-window-v1"),
        start_at: new Date(Math.floor(Date.parse(manifest.cutoff)/60000)*60000-21_600_000).toISOString(), end_at: new Date(Math.floor(Date.parse(manifest.cutoff)/60000)*60000).toISOString(), part: 0 };
      let next: GmgnRequest | null = null;
      for (let part=0;part<4;part++) {
        const exists=await settings.db.prepare(`SELECT id FROM tenx_source_reservations WHERE json_extract(request,'$.series.id')=?1
          AND json_extract(request,'$.series.part')=?2 LIMIT 1`).bind(root.id,part).first();
        if (!exists) { const series={...root,part};next={kind,address,...gmgnCandlePart(series),series};break; }
      }
      if (!next) continue;request=next;
    } else {
      const old=await settings.db.prepare(`SELECT id FROM tenx_source_reservations WHERE day=?1 AND json_extract(request,'$.address')=?2
        AND json_extract(request,'$.kind')=?3 LIMIT 1`).bind(day,address,kind).first();
      if(old)continue;request={kind,address};
    }
    gmgnDescriptor(request, at);
    // Stable per-day target ID prevents competing maintenance runs reserving a
    // second copy even after the first transport finishes.
    const request_id = await gmgnStableId(request.kind === "gmgn_token_candles" && request.series ? request.series.id+":"+request.series.part : day+":"+address+":"+kind);
    return runGmgnReview(settings, { reason: "Frozen daily inventory rotation in spare maintenance capture", request_id, mode: "retained_research", request }, fetcher, clock,day);
  }
  return { state: "waiting", reason: "declared_daily_cohort_attempted", provider_requests: 0 };
}
export async function runGmgnReview(settings: GmgnSettings, raw: unknown, fetcher: SourceFetcher, clock = () => new Date(), scheduledDay?:string) {
  const input = GmgnReviewRequestSchema.parse(raw);
  const held = (reason: string) => ({ state: "held" as const, reason, provider_requests: 0, scoring_effect: "none" });
  if (!configured(settings.apiKey)) return held("gmgn_key_missing_or_invalid");
  if (input.mode === "access_probe" && input.request.kind !== "gmgn_token_info") return held("gmgn_probe_info_only");
  if (input.mode === "retained_research" && !permitted(settings.permissionReference)) return held("gmgn_research_rights_unresolved");
  if(input.request.kind==="gmgn_wallet_activity"){
    const target=await gmgnActivityTarget(settings.db,input.request.selection_id,clock());
    if(target.state!=="ready"||target.request.address!==input.request.address||target.request.wallet!==input.request.wallet||target.request.selection_hash!==input.request.selection_hash)return held("gmgn_activity_selection_mismatch_or_unavailable");
  }
  const reservation = await reserveSourceFetch(settings.db, input.request_id, input.request, Math.min(L.market_daily_maximum, settings.marketDailyLimit), clock(), settings.researchMode,scheduledDay);
  if (!reservation) return held("shared_budget_pause_pacing_or_existing_request");
  return { ...await executeReservedSource(settings.db, reservation, fetcher, clock, { apiKey: settings.apiKey!, mode: input.mode, permissionReference: settings.permissionReference }),
    request_id: input.request_id, scoring_effect: "none" };
}
export async function gmgnSavedReview(db: D1Database, id: string, cutoff?: string) {
  z.uuid().parse(id);
  const requestRow = await db.prepare("SELECT request FROM tenx_source_reservations WHERE id=?1").bind(id).first<{request:string}>();
  if (!requestRow) return null;
  const parsed = GmgnRequestSchema.safeParse(JSON.parse(requestRow.request));
  if (!parsed.success) return null;
  const saved = await readSourceReceipt(db, id);
  if (!saved) return { state: "pending", provider_requests: 0 };
  const receipt = saved.receipt;
  const traderReplay=parsed.data.kind==="gmgn_token_traders"&&receipt.error===null&&receipt.response!==null?{
    version:"gmgn-trader-replay-v1",request:parsed.data,receipt,receipt_hash:await hashJson(receipt),
    report_hash:await hashJson(normalizeGmgn(parsed.data,receipt.response,receipt.received_at))}:null;
  let activityReplay=null;
  if(parsed.data.kind==="gmgn_wallet_activity"&&receipt.error===null&&receipt.response!==null){
    const selection=await gmgnTraderSourceRecord(db,parsed.data.selection_id);
    if(!selection||selection.receipt_hash!==parsed.data.selection_hash)throw Error("gmgn_activity_selection_receipt_missing");
    activityReplay={version:"gmgn-wallet-activity-replay-v1",request:parsed.data,receipt,receipt_hash:await hashJson(receipt),report_hash:await hashJson(normalizeGmgn(parsed.data,receipt.response,receipt.received_at)),selection_record:selection};
  }
  return { replay: saved.replay, request_id: id, request: parsed.data, source_authenticity: saved.source_authenticity,
    received_at: receipt.received_at, http_status: receipt.status, error: receipt.error, validation_failure: receipt.validation_failure ?? null,
    ...(receipt.activity_validation_fields?{activity_validation_fields:receipt.activity_validation_fields}:{}),
    access_probe: receipt.access_probe, access_accepted: receipt.access_accepted,
    observation: receipt.error === null && receipt.response !== null ? normalizeGmgn(parsed.data, receipt.response, receipt.received_at, cutoff ?? receipt.received_at, undefined,
      receipt.semantic_validation === "gmgn_selected_fields_v1" ? "v1" : "v2") : null,
    ...(traderReplay?{trader_replay:traderReplay}:{}),...(activityReplay?{activity_replay:activityReplay}:{}),provider_requests: 0, scoring_effect: "none" };
}
async function gmgnTraderSourceRecord(db:D1Database,id:string){
  const row=await db.prepare("SELECT request FROM tenx_source_reservations WHERE id=?1").bind(id).first<{request:string}>();
  if(!row)return null;const request=GmgnRequestSchema.parse(JSON.parse(row.request));if(request.kind!=="gmgn_token_traders")return null;
  const saved=await readSourceReceipt(db,id),receipt=saved?.receipt;if(!receipt||receipt.error!==null||receipt.response===null)return null;
  return{version:"gmgn-trader-replay-v1",request,receipt,receipt_hash:await hashJson(receipt),report_hash:await hashJson(normalizeGmgn(request,receipt.response,receipt.received_at))};
}
export async function gmgnActivityTarget(db:D1Database,id:string,now=new Date()){
  z.uuid().parse(id);const record=await gmgnTraderSourceRecord(db,id);
  if(!record)return{state:"held" as const,reason:"retained_trader_sample_required",provider_requests:0};
  try{const selected=await gmgnActivitySelection(record,now);
    return{state:"ready" as const,request:{kind:"gmgn_wallet_activity" as const,address:selected.address,wallet:selected.wallet,selection_id:id,selection_hash:selected.selection_hash},provider_requests:0};
  }catch{return{state:"held" as const,reason:"selection_unusable_stale_or_future",provider_requests:0};}
}

export async function gmgnCandleWindow(db: D1Database, id: string) {
  z.uuid().parse(id);
  const rows = await db.prepare(`SELECT id,request,request_hash,state FROM tenx_source_reservations
    WHERE json_extract(request,'$.series.id')=?1 ORDER BY reserved_at,id LIMIT 5`).bind(id).all<{id:string;request:string;request_hash:string;state:string}>();
  if (!rows.results.length) return null;
  if (rows.results.length > 4) throw new Error("gmgn_window_duplicate_parts");
  const entries = [];
  for (const row of rows.results) {
    const request = GmgnRequestSchema.parse(JSON.parse(row.request));
    if (await hashJson(request) !== row.request_hash) throw new Error("gmgn_window_request_hash_mismatch");
    const saved = await readSourceReceipt(db, row.id), receipt = saved?.receipt;
    if (receipt && receipt.research_permission_reference !== GMGN_USE_AUTHORITY) throw new Error("gmgn_window_permission_mismatch");
    entries.push({ id: row.id, request, state: row.state, received_at: receipt?.received_at ?? null,
      receipt_hash: receipt ? await hashJson(receipt) : null, response: receipt?.error === null ? receipt.response : null });
  }
  return assembleGmgnWindow(entries);
}

export async function gmgnPublicSummary(db: D1Database, rawAddress: string, now = new Date()) {
  const address = Address.parse(rawAddress), kinds = ["gmgn_token_info", "gmgn_token_security", "gmgn_token_pool", "gmgn_token_candles", "gmgn_token_traders", "gmgn_wallet_activity"];
  const observations = [];
  let activityRequestId:string|null=null;
  for (const kind of kinds) {
    const row = await db.prepare(`SELECT id FROM tenx_source_reservations WHERE state='succeeded' AND day>=?4
      AND json_extract(request,'$.address')=?1 AND json_extract(request,'$.kind')=?2
      AND json_extract(receipt,'$.research_permission_reference')=?3 ORDER BY reserved_at DESC,id DESC LIMIT 1`)
      .bind(address, kind, GMGN_USE_AUTHORITY, new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10)).first<{id:string}>();
    if (row) {
      const saved = await gmgnSavedReview(db, row.id);
      if (saved && "observation" in saved && saved.observation){observations.push(saved.observation);if(kind==="gmgn_wallet_activity")activityRequestId=row.id;}
    }
  }
  const latestWindow = await db.prepare(`SELECT json_extract(request,'$.series.id') AS id FROM tenx_source_reservations
    WHERE day>=?2 AND json_extract(request,'$.address')=?1 AND json_extract(request,'$.series.id') IS NOT NULL
    ORDER BY json_extract(request,'$.series.end_at') DESC,reserved_at DESC,id DESC LIMIT 1`).bind(address,new Date(now.getTime()-6*86_400_000).toISOString().slice(0,10)).first<{id:string}>();
  const coverage=latestWindow?await gmgnCandleWindow(db,latestWindow.id):null;
  const info = observations.find(v => v.kind === "gmgn_token_info"), security = observations.find(v => v.kind === "gmgn_token_security"), candles = observations.find(v => v.kind === "gmgn_token_candles");
  const infoMetrics = z.object({ reported_holder_count: z.number().nullable(), reported_volume_usd: z.object({ volume_24h: z.number().nullable(), volume_1h: z.number().nullable() }).nullable() }).nullable().parse(info?.metrics ?? null);
  const flags = z.object({ provider_flags: z.object({ is_wash_trading: z.boolean().nullable(), rug_ratio: z.number().nullable(), suspected_insider_hold_rate: z.number().nullable(), bundler_trader_amount_rate: z.number().nullable() }) }).nullable().parse(security?.metrics ?? null)?.provider_flags;
  const window = z.object({ candle_count: z.number(), complete_window: z.boolean(), reported_volume_usd: z.number().nullable() }).nullable().parse(candles?.metrics ?? null);
  const review = candles?.version === "gmgn-observation-v2" ? z.object({ window_start: z.string(), window_end: z.string(), activity: z.record(z.string(), z.unknown()) }).parse(candles.metrics) : null;
  const trader=observations.find(v=>v.kind==="gmgn_token_traders");
  const traderSample=trader?GmgnTraderSampleSchema.parse(trader.metrics):null;
  const activity=observations.find(v=>v.kind==="gmgn_wallet_activity"),walletActivity=activity?GmgnWalletActivitySchema.parse(activity.metrics):null;
  const lastActivity=await db.prepare(`SELECT id FROM tenx_source_reservations WHERE day>=?2 AND json_extract(request,'$.address')=?1
    AND json_extract(request,'$.kind')='gmgn_wallet_activity' AND state IN ('succeeded','failed')
    ORDER BY reserved_at DESC,id DESC LIMIT 1`).bind(address,new Date(now.getTime()-6*86_400_000).toISOString().slice(0,10)).first<{id:string}>();
  const lastActivitySaved=lastActivity?await gmgnSavedReview(db,lastActivity.id):null;
  const activityIssue=lastActivitySaved&&"error"in lastActivitySaved&&lastActivitySaved.error?{received_at:lastActivitySaved.received_at,http_status:lastActivitySaved.http_status,error:lastActivitySaved.error,fields:lastActivitySaved.activity_validation_fields??[]}:null;
  const dates = observations.map(v => v.received_at).sort();
  const gaps = [...new Set(observations.flatMap(v => v.gaps))];
  if (candles && !gaps.includes("candle_volume_units_unverified")) gaps.push("candle_volume_units_unverified");
  if(coverage)gaps.push(...coverage.gaps);
  gaps.push("summary_limited_to_recent_seven_utc_days");
  if (!observations.length) gaps.push("no_retained_gmgn_observations");
  if (observations.some(v => now.getTime() - Date.parse(v.received_at) > 300_000 || Date.parse(v.received_at) > now.getTime())) gaps.push("receipt_stale_or_future");
  return GmgnPublicSummarySchema.parse({ version: "gmgn-summary-v1", address, use_authority: GMGN_USE_AUTHORITY,
    provider_rights_independently_confirmed: false, observations: observations.length, received_at: dates.at(-1) ?? null, provider_observed_at: null,
    stale: !observations.length || gaps.includes("receipt_stale_or_future"),
    reported_volume_24h_usd: infoMetrics?.reported_volume_usd?.volume_24h ?? null, reported_volume_1h_usd: infoMetrics?.reported_volume_usd?.volume_1h ?? null,
    reported_holder_count: infoMetrics?.reported_holder_count ?? null,
    provider_wash_flag: flags?.is_wash_trading ?? null, provider_rug_ratio: flags?.rug_ratio ?? null,
    provider_insider_hold_ratio: flags?.suspected_insider_hold_rate ?? null, provider_bundler_volume_ratio: flags?.bundler_trader_amount_rate ?? null,
    // Archived v1 operator replay stays unchanged, but ambiguous candle units
    // cannot be presented as corroborated USD in a current public projection.
    candle_count: coverage?.candle_count ?? window?.candle_count ?? null, candle_window_complete: coverage?.complete_window ?? window?.complete_window ?? null, candle_window_volume_usd: coverage?.reported_window_volume_usd ?? null,
    candle_coverage:coverage?{window_id:coverage.window_id,expected_parts:4,attempted_parts:coverage.attempted_parts,succeeded_parts:coverage.succeeded_parts,failed_parts:coverage.failed_parts,missing_minutes:coverage.missing_minutes,overlap_conflicts:coverage.overlap_conflicts,receipt_span_ms:coverage.receipt_span_ms,units:coverage.units,report_hash:coverage.report_hash}:null,
    candle_review:coverage?(coverage.activity&&coverage.received_at?{received_at:coverage.received_at,window_start:coverage.window_start,window_end:coverage.window_end,...coverage.activity}:null):review ? { received_at: candles!.received_at, window_start: review.window_start, window_end: review.window_end, ...review.activity } : null,
    trader_sample:traderSample,wallet_activity:walletActivity,wallet_activity_request_id:activityRequestId,wallet_activity_issue:activityIssue,gaps: [...new Set(gaps)], organic_volume_usd: null, meaningful_holder_growth: null, scoring_effect: "none" });
}
