import { API_HEADERS, LOCAL_ORIGINS, authorized, requireAdminBrowser, requireLocalReadBrowser, adminJson, RequestSecurityError } from "./request-security";
import {historyDirectory} from "./history-directory";
import {buildScoreReadModel,readScoreReadModel} from "./score-read-model";
import {buildScoreReadPages,readScoreReadPages} from "./score-read-pages";
import { contentRoute } from "./content-route";
import { ContentError } from "./content-url";
export { authorized } from "./request-security";
import { createRewards, rewardList, rewardRecord } from "./rewards";
import { RewardError } from "./reward-math";
import { createLaunch, launchList, launchRecord } from "./launch-lab";
import { LaunchError } from "./launch-math";
import {createRecovery,recoveryList,recoveryRecord} from "./launch-recovery-store";
import {RecoveryError} from "./launch-recovery-math";
import { z } from "zod";
import { candidateCard } from "./candidate-card";
import { identityRoute, IdentityError } from "./identity";
import { backingList, backingRecord, BackingError, freezeBacking, openBacking, settleBacking } from "./backing";
import { runBackingIndex, backingIndexLimit } from "./backing-index";
import { Address, assess, CandidateSchema, DEFAULT_POLICY, MarketSchema, Signature, shortlist } from "./model";
import { runReviews } from "./research";
import { runMarketCycle } from "./market-cycle";
import { runWalletCycle, walletStatus } from "./wallet-cycle";
import { ADAPTER_VERSION } from "./pump";
import { audit, candidates, control, dryRun, researchDay, saveCandidate } from "./store";
import { fixtureCandidates } from "./fixtures";
import { runCycle } from "./ingest";
import { hashJson } from "./solana";
import { ElectionId } from "./election-model";
import { dailyElection, ElectionError, electionAutomation, electionRecord, electionSummaries, replayElection } from "./elections";
import { qualityStatus, runQualityCycle } from "./quality-cycle";
import { discoveryCoverage } from "./coverage";
import {discoveryYield} from "./discovery-yield";
import { createdWithinWindow } from "./priority";
import { activitySummary } from "./activity";
import { WalletEvidenceSchema } from "./wallet-analysis";
import { artworkFor, runArtworkCycle } from "./artwork";
import { safeMetadataUrl } from "./images";
import { catchupLimit, replayLegacyWallets, walletWork } from "./wallet-work";
import { createPolicyPreview, policyPreviewRecord, PolicyPreviewError, publicPolicy } from "./policies";
import { runSignalCycle, signalDetail, signalResearch } from "./signal-research";
import { SignalKind } from "./signal-model";
import { SignalResearchError } from "./signal-analysis";
import { walletPlans } from "./wallet-plan";
import { operations, OperationsError, recordWatchdog } from "./operations";
import { WatchdogReportSchema } from "./operations-model";
import { inboxRecoveryStatus } from "./inbox-recovery";
import { enqueueMintReview, mintReviews, MintReviewError } from "./mint-review";
import { mintIntakeStatus } from "./mint-intake-status";
import { MINT_REVIEW_LIMITS } from "./mint-review-model";
import { candidateExpiry, expireCandidates, inventoryStatus } from "./candidate-expiry";
import { marketBatches,marketBatchRecord } from "./market-batch-store";
import {candidateScorecard,rankedDiscovery,scoreInventoryCandidates} from "./discovery-score-store";
import {DiscoveryScoreError} from "./discovery-score";
import {replayAnyDiscoveryScore} from "./discovery-score-replay";
import {ScoreModelSchema} from "./score-research-model";
import {runScoreResearch,scoreResearch,scoreResearchDetail} from "./score-research";
import {ScoreResearchError} from "./score-research-analysis";
import {scoreFollowupPlan} from "./score-followup";
import { sourcePilotReadiness } from "./source-pilot-readiness";
import { gmgnPublicSummary, gmgnCandleWindow, gmgnSavedReview, gmgnStatus, runGmgnReview, runGmgnPilot, gmgnPilotHasCapacity,gmgnActivityTarget } from "./gmgn";
import { GMGN_USE_AUTHORITY } from "./gmgn-model";
import { runShortlistQuery } from "./shortlist-query";
import { collectAttention, readAttentionQueue, reviewAttention, collectAttentionCandles, collectAttentionTraders } from "./attention-queue";
import { collectAttentionActivity } from "./attention-activity-collection";

import { researchMode } from "./research-limits";
import { holderHistory } from "./holder-history-store";
import { HolderHistoryError } from "./holder-history";
import { holderAcquisition } from "./holder-acquisition-store";
import { attentionHolderRequest, attentionHolderParticipation } from "./attention-holder-participation";
import { HolderAcquisitionError } from "./holder-acquisition";
import{gmgnCorroboration,collectGmgnCorroboration}from"./gmgn-corroboration-store";
import{gmgnEventSample}from"./gmgn-event-sample-store";
import{collectGmgnEventSample,gmgnEventCollection}from"./gmgn-event-collection";
import{gmgnQuote}from"./gmgn-quote-store";
import{ComparisonAddresses,discoveryComparison}from"./discovery-comparison";
import { rotationCoverage } from "./rotation-coverage";
import {d1EvidenceReadStore} from "./evidence-read-store";

// Widen generated literal vars so ignored .dev.vars overrides stay type-safe.
type OptionalGmgnSecret = "GMGN_API_KEY" | "TENX_RESEARCH_MODE";
export type LocalEnv = { [K in Exclude<keyof Cloudflare.Env, OptionalGmgnSecret>]: Cloudflare.Env[K] extends string ? string : Cloudflare.Env[K] }
  & { [K in Extract<keyof Cloudflare.Env, OptionalGmgnSecret>]?: string };
type Env = LocalEnv;
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
const origins = LOCAL_ORIGINS;
const headers = API_HEADERS;
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers }); }
function gmgnSettings(env: Env) {
  return { db: env.TENX_DB, apiKey: "GMGN_API_KEY" in env && typeof env.GMGN_API_KEY === "string" ? env.GMGN_API_KEY : undefined,
    permissionReference: GMGN_USE_AUTHORITY, researchMode: researchMode(env), marketDailyLimit: Math.min(600, z.coerce.number().int().min(0).max(1000).parse(env.TENX_MARKET_DAILY_LIMIT)) };
}
function gmgnFetcher(env: Env) {
  return async (url: string, init: RequestInit) => {
    if (env.TENX_NODE_RELAY !== "true") return fetch(url, init);
    const target = new URL(url);
    if (target.origin !== "https://openapi.gmgn.ai") throw new Error("gmgn_relay_target_not_allowed");
    return fetch(`http://127.0.0.1:8795/gmgn${target.pathname}${target.search}`, { method: init.method ?? "GET", ...(init.body ? {body:init.body}:{}),
      headers: { "x-tenx-local-relay": env.TENX_ADMIN_TOKEN, "x-tenx-gmgn-key": new Headers(init.headers).get("X-APIKEY") ?? "", ...(init.body ? {"content-type":"application/json"}:{}) },
      signal: init.signal, redirect: "manual", credentials: "omit" });
  };
}
function attentionFetcher(env: Env) {
  return async (url: string, init: RequestInit) => {
    const target=new URL(url);
    if(target.origin==="https://openapi.gmgn.ai")return gmgnFetcher(env)(url,init);
    if(env.TENX_NODE_RELAY!=="true")return fetch(url,init);
    const path=target.origin==="https://api.geckoterminal.com" ? `/market/trending/global/${target.searchParams.get("duration")}/${target.searchParams.get("page")}`
      : target.origin==="https://api.dexscreener.com" ? `/dex/attention/${target.pathname.split("/")[3]}/${target.pathname.split("/")[4]}` : null;
    if(!path)throw Error("attention_relay_target_not_allowed");
    return fetch(`http://127.0.0.1:8795${path}`,{...init,headers:{"x-tenx-local-relay":env.TENX_ADMIN_TOKEN},redirect:"manual",credentials:"omit"});
  };
}
function settings(env: Env) {
  const transport: typeof fetch | undefined = env.TENX_NODE_RELAY === "true" ? async (input, init) => {
    const target = new URL(String(input));
    const market = target.hostname === "api.geckoterminal.com" && /^\/api\/v2\/networks\/solana\/pools\/(?:multi\/)?[1-9A-HJ-NP-Za-km-z,]{32,1350}$/.test(target.pathname);
    const dex = target.hostname === "api.dexscreener.com" && /^\/tokens\/v1\/solana\/[1-9A-HJ-NP-Za-km-z,]{32,1350}$/.test(target.pathname);
    const metadata = safeMetadataUrl(target.href) === target.href;
    const path = target.href === new URL(env.TENX_RPC_URL).href ? "/rpc" : market ? target.pathname.replace("/api/v2/networks/solana", "/market") : dex ? target.pathname.replace("/tokens/v1/solana/", "/dex/tokens/") : metadata ? `/metadata${target.pathname}` : null;
    if (!path) throw new Error("relay_target_not_allowed");
    return fetch(`http://127.0.0.1:8795${path}`, { method: path === "/rpc" ? "POST" : "GET", headers: { "x-tenx-local-relay": env.TENX_ADMIN_TOKEN, "content-type": "application/json" }, ...(path === "/rpc" ? { body: init?.body } : {}), signal: init?.signal, redirect: "manual" });
  } : undefined;
  return {
    db: env.TENX_DB, rpcUrl: env.TENX_RPC_URL,
    rpcDailyLimit: z.coerce.number().int().min(1).max(10_000).parse(env.TENX_RPC_DAILY_LIMIT),
    marketDailyLimit: z.coerce.number().int().min(1).max(1000).parse(env.TENX_MARKET_DAILY_LIMIT),
    marketEnabled: env.TENX_MARKET_ENABLED === "true",
    marketProvider: z.enum(["geckoterminal", "dexscreener"]).parse(env.TENX_MARKET_PROVIDER),
    walletEnabled: env.TENX_WALLET_ANALYSIS_ENABLED === "true",
    walletDailyLimit: z.coerce.number().int().min(1).max(2000).parse(env.TENX_WALLET_RPC_DAILY_LIMIT),
    qualityEnabled: env.TENX_QUALITY_ENABLED === "true",
    qualityDailyLimit: z.coerce.number().int().min(1).max(2000).parse(env.TENX_QUALITY_RPC_DAILY_LIMIT),
    paced: true,
    batchedMarket: true,
    transport,
  };
}
async function envelope(env: Env, data: unknown, extra: Record<string, unknown> = {}) {
  const state = await control(env.TENX_DB);
  return {
    api_version: "10x-discovery-v1", trace_id: crypto.randomUUID(),
    as_of: state.last_success, served_at: new Date().toISOString(), policy_version: DEFAULT_POLICY.version,
    source_freshness: { last_harvest: state.last_harvest, last_success: state.last_success, stale: !state.last_success || Date.now() > Math.max(Date.parse(state.last_success) + 180_000, Date.parse(state.next_refresh_at ?? state.last_success) + 180_000) },
    coverage: { scope: "bounded_pump_migration_authority_scan", exhaustive: false, history_limit: 3000, quote_support: "WSOL only", holder_classification: "reconciled_token_owner_inventory_when_available", market_enabled: env.TENX_MARKET_ENABLED === "true" },
    data, ...extra,
  };
}
async function status(env: Env) {
  const state = await control(env.TENX_DB);
  const usage = await env.TENX_DB.prepare("SELECT provider,used FROM tenx_usage WHERE day=?1").bind(new Date().toISOString().slice(0, 10)).all();
  const count = await env.TENX_DB.prepare("SELECT count(*) AS count FROM tenx_pending_signatures WHERE processed_at IS NULL").first<{ count: number }>();
  const marketState = await env.TENX_DB.prepare("SELECT last_success,last_error,next_refresh_at FROM tenx_market_control WHERE id=1").first();
  return {
    local_only: true, paused: Boolean(state.paused), running: Boolean(state.lease_until && state.lease_until > new Date().toISOString()),
    last_error: state.last_error, retry_after: state.retry_after, pending_signatures: count?.count ?? 0,
    usage: usage.results, daily_limits: { rpc: Number(env.TENX_RPC_DAILY_LIMIT), market: Number(env.TENX_MARKET_DAILY_LIMIT), artwork: 120, wallet_catchup: catchupLimit(Number(env.TENX_WALLET_RPC_DAILY_LIMIT)), mint_intake:MINT_REVIEW_LIMITS.rpc_daily_subset },
    backing_index_automation:{enabled:env.TENX_WALLET_ANALYSIS_ENABLED==="true",daily_limit:backingIndexLimit(Number(env.TENX_WALLET_RPC_DAILY_LIMIT)),daily_used:(await env.TENX_DB.prepare("SELECT used FROM tenx_backing_index_usage WHERE day=?").bind(new Date().toISOString().slice(0,10)).first<{used:number}>())?.used??0,scope:"subset_of_wallet_and_global_RPC_limits"},
    adapter_version: ADAPTER_VERSION, policy: DEFAULT_POLICY,
    market_provider: env.TENX_MARKET_PROVIDER,
    automation: { heartbeat_at: state.heartbeat_at, next_refresh_at: state.next_refresh_at, reviewed_at: state.reviewed_at, review_timezone: "Australia/Sydney", review_cadence: "hourly catch-up of prior three days", refresh_cadence: "paced across the remaining free daily budget" },
    market_automation: marketState,
    artwork_automation: await env.TENX_DB.prepare("SELECT next_refresh_at,last_error FROM tenx_artwork_control WHERE id=1").first(),
    wallet_automation: await walletStatus(env.TENX_DB, Number(env.TENX_WALLET_RPC_DAILY_LIMIT), env.TENX_WALLET_ANALYSIS_ENABLED === "true"),
    election_automation: await electionAutomation(env.TENX_DB),
    inventory: await inventoryStatus(env.TENX_DB),
    market_batches: await marketBatches(env.TENX_DB),
    source_pilot: sourcePilotReadiness(),
    quality_automation: await qualityStatus(env.TENX_DB, Number(env.TENX_QUALITY_RPC_DAILY_LIMIT), env.TENX_QUALITY_ENABLED === "true"),
    capabilities: { discovery: true, voting: false, launches: false, signing: false, rewards: false, social_publishing: false },
  };
}
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (env.TENX_LOCAL_ONLY !== "true" || !loopback.has(url.hostname)) return json({ error: "local_runtime_required" }, 503);
  if(request.method==="GET"){
    try{requireLocalReadBrowser(request);}
    catch(error){if(error instanceof RequestSecurityError)return json({error:error.message},error.status);throw error;}
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.startsWith("/api/10x/identity/")) return identityRoute(request, env.TENX_DB);
  const admin = path.startsWith("/api/10x/admin/");
  const method = request.method;
  if (admin && !authorized(request, env.TENX_ADMIN_TOKEN)) return json({ error: "admin_authentication_required" }, 401);
  if (admin) {
    try { requireAdminBrowser(request); }
    catch (error) { if (error instanceof RequestSecurityError) return json({ error: error.message }, error.status); throw error; }
  }
  if (method !== "GET" && method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (path.startsWith("/api/10x/attention/") || path.startsWith("/api/10x/admin/attention/")) return contentRoute(request, env.TENX_DB, admin);
  if (method === "GET" && path === "/api/10x/rewards/lab") return json(await rewardList(env.TENX_DB));
  if(method==="GET"&&path==="/api/10x/launches/lab")return json(await launchList(env.TENX_DB));
  if(method==="GET"&&path==="/api/10x/launches/recovery-lab")return json(await recoveryList(env.TENX_DB));
  const recoveryMatch=path.match(/^\/api\/10x\/admin\/launches\/recovery-lab\/([^/]+)$/);
  if(method==="GET"&&recoveryMatch){const record=await recoveryRecord(env.TENX_DB,recoveryMatch[1]);return record?json({record,replay:"verified"}):json({error:"recovery_record_not_found"},404);}
  const launchMatch=path.match(/^\/api\/10x\/admin\/launches\/lab\/([^/]+)$/);
  if(method==="GET"&&launchMatch){const record=await launchRecord(env.TENX_DB,launchMatch[1]);return record?json({record,replay:"verified"}):json({error:"launch_record_not_found"},404);}
  const rewardMatch = path.match(/^\/api\/10x\/admin\/rewards\/lab\/([^/]+)$/);
  if (method === "GET" && rewardMatch) {
    const record = await rewardRecord(env.TENX_DB, rewardMatch[1]);
    return record ? json({ record, replay: "verified" }) : json({ error: "reward_not_found" }, 404);
  }
  if (method === "POST" && request.headers.has("origin") && !origins.has(request.headers.get("origin")!)) return json({ error: "origin_not_allowed" }, 403);
  if (method === "POST" && !admin) return json({ error: "not_found" }, 404);
  if (method === "GET" && path === "/api/10x/health") return json({ local: true, ready: true });
  const eventSample=path.match(/^\/api\/10x\/gmgn\/event-sample\/([a-f0-9-]{36})$/i);
  if(method==="GET"&&eventSample){
    if(!z.uuid().safeParse(eventSample[1]).success)return json({error:"invalid_activity_id"},400);
    try{const result=await gmgnEventSample(env.TENX_DB,eventSample[1]!,new Date(),"v2");return result?json(result.report):json({error:"accepted_research_activity_not_found"},404);}
    catch{return json({error:"gmgn_event_sample_unavailable"},503);}
  }
  const eventCollection=path.match(/^\/api\/10x\/admin\/gmgn\/event-sample\/([a-f0-9-]{36})$/i);
  if(method==="GET"&&eventCollection){
    if(!z.uuid().safeParse(eventCollection[1]).success)return json({error:"invalid_activity_id"},400);
    try{const record=await gmgnEventCollection(env.TENX_DB,eventCollection[1]!);return record?json(record):json({error:"gmgn_event_collection_not_found"},404);}
    catch{return json({error:"gmgn_event_collection_unavailable"},503);}
  }
  const rpcComparison=path.match(/^\/api\/10x\/(admin\/)?gmgn\/corroboration\/([a-f0-9-]{36})$/i);
  const quoteReview=path.match(/^\/api\/10x\/(admin\/)?gmgn\/quote\/([a-f0-9-]{36})$/i);
  if(method==="GET"&&quoteReview){const result=await gmgnQuote(env.TENX_DB,quoteReview[2]!);return result?json(quoteReview[1]?result:result.report):json({error:"accepted_activity_not_found"},404);}
  if(method==="GET"&&rpcComparison){const result=await gmgnCorroboration(env.TENX_DB,rpcComparison[2]!);return result?json(rpcComparison[1]?result:result.report):json({error:"accepted_activity_not_found"},404);}
  const attentionHolders = path.match(/^\/api\/10x\/discovery\/attention\/holders\/solana\/([^/]+)$/);
  if(method==="GET"&&attentionHolders){
    const subject=attentionHolderRequest(attentionHolders[1]!,url.searchParams);
    try{return json(await attentionHolderParticipation(env.TENX_DB,subject.address,subject.at));}
    catch{return json({error:"saved_holder_participation_unavailable"},503);}
  }
  const holderBuys = path.match(/^\/api\/10x\/(admin\/)?holders\/acquisition\/solana\/([^/]+)$/);
  if(method==="GET"&&holderBuys){const result=await holderAcquisition(env.TENX_DB,holderBuys[2]!);return json(holderBuys[1]?result:result.report);}
  const holderChanges = path.match(/^\/api\/10x\/(admin\/)?holders\/history\/solana\/([^/]+)$/);
  if (method === "GET" && holderChanges) {
    const result = await holderHistory(env.TENX_DB,holderChanges[2]!);
    return json(holderChanges[1] ? result : result.report);
  }
  if (method === "GET" && path === "/api/10x/admin/gmgn/status") return json(await gmgnStatus(gmgnSettings(env)));
  if (method === "GET" && path === "/api/10x/admin/score-read-model") return json(await readScoreReadModel(env.TENX_DB));
  if (method === "GET" && path === "/api/10x/admin/score-read-pages") return json(await readScoreReadPages(env.TENX_DB,Object.fromEntries(url.searchParams)));
  const activityTarget=path.match(/^\/api\/10x\/admin\/gmgn\/activity-target\/([a-f0-9-]{36}|attention-traders-\d{10})$/i);
  if(method==="GET"&&activityTarget)return json(await gmgnActivityTarget(env.TENX_DB,activityTarget[1]!));
  const gmgnWindow=path.match(/^\/api\/10x\/admin\/gmgn\/windows\/([a-f0-9-]{36})$/i);
  if(method==="GET"&&gmgnWindow){const report=await gmgnCandleWindow(env.TENX_DB,gmgnWindow[1]!);return report?json(report):json({error:"gmgn_window_not_found"},404);}
  const gmgnReview = path.match(/^\/api\/10x\/admin\/gmgn\/reviews\/([a-f0-9-]{36}|attention-(?:traders|candles)-\d{10})$/i);
  if (method === "GET" && gmgnReview) { const saved = await gmgnSavedReview(env.TENX_DB, gmgnReview[1]!); return saved ? json(saved) : json({ error: "gmgn_review_not_found" }, 404); }
  const gmgnToken = path.match(/^\/api\/10x\/gmgn\/solana\/([^/]+)$/);
  if (method === "GET" && gmgnToken) return json(await gmgnPublicSummary(env.TENX_DB, gmgnToken[1]!));
  if (method === "GET" && path === "/api/10x/backing") return json(await backingList(env.TENX_DB));
  const backingMatch = path.match(/^\/api\/10x\/admin\/backing\/([^/]+)$/);
  if (method === "GET" && backingMatch) {
    const record = await backingRecord(env.TENX_DB,z.uuid().parse(backingMatch[1]));
    return record ? json({record,replay:"verified"}) : json({error:"backing_not_frozen_or_not_found"},404);
  }
  if (method === "GET" && path === "/api/10x/chains") return json(await envelope(env, [{ id: "solana", discover_enabled: true, vote_enabled: false, launch_enabled: false }]));
  if (method === "GET" && path === "/api/10x/system/status") return json(await envelope(env, await status(env)));
  if (method === "GET" && path === "/api/10x/system/operations") return json(await envelope(env,await operations(settings(env))));
  if (method === "GET" && path === "/api/10x/discovery/coverage") return json(await envelope(env, discoveryCoverage(await candidates(env.TENX_DB), DEFAULT_POLICY, new Date())));
  if (method === "GET" && path === "/api/10x/discovery/yield") return json(await discoveryYield(env.TENX_DB));
  if (method === "GET" && path === "/api/10x/discovery/attention") return json(await readAttentionQueue(env.TENX_DB));
  const intakeStatus = path.match(/^\/api\/10x\/discovery\/intake\/solana\/([^/]+)$/);
  if (method === "GET" && intakeStatus) {
    if (url.search || !Address.safeParse(intakeStatus[1]).success) return json({ error: "intake_status_request_invalid" }, 400);
    try { return json(await mintIntakeStatus(env.TENX_DB, intakeStatus[1]!)); }
    catch { return json({ error: "intake_status_unavailable" }, 503); }
  }
  if (method === "GET" && path === "/api/10x/discovery/rotation-coverage") return json(await envelope(env, await rotationCoverage(env.TENX_DB)));
  if (method === "GET" && path === "/api/10x/discovery/wallet-plan") return json(await envelope(env,await walletPlans(env.TENX_DB)));
  if (method === "GET" && path === "/api/10x/discovery/inbox-recovery") return json(await envelope(env,await inboxRecoveryStatus(env.TENX_DB)));
  if (method === "GET" && path === "/api/10x/discovery/mint-reviews") return json(await envelope(env,await mintReviews(env.TENX_DB)));
  if (method === "GET" && path === "/api/10x/discovery/wallet-work") {
    const usage = await env.TENX_DB.prepare("SELECT used FROM tenx_usage WHERE provider='wallet_catchup' AND day=?1").bind(new Date().toISOString().slice(0,10)).first<{used:number}>();
    return json(await envelope(env, { work: await walletWork(env.TENX_DB), catchup_reserved: usage?.used ?? 0, catchup_limit: catchupLimit(Number(env.TENX_WALLET_RPC_DAILY_LIMIT)), snapshot_refresh_required: true }));
  }
  if (method === "GET" && path === "/api/10x/artwork") {
    const addresses = z.array(Address).min(1).max(100).parse((url.searchParams.get("addresses") ?? "").split(","));
    return json(await envelope(env, await artworkFor(env.TENX_DB, addresses)));
  }
  if (method === "GET" && path === "/api/10x/elections") return json(await envelope(env, { runs: await electionSummaries(env.TENX_DB), automation: await electionAutomation(env.TENX_DB), schedule: "First local maintenance tick each UTC day; actual observation time, no missed-day backfill", voting_enabled: false, launch_enabled: false }));
  const electionMatch = path.match(/^\/api\/10x\/elections\/([^/]+)$/);
  if (method === "GET" && electionMatch) {
    const record = await electionRecord(env.TENX_DB, ElectionId.parse(electionMatch[1]));
    if (!record) return json({ error: "election_not_found" }, 404);
    return json(await envelope(env, { record, replay: await replayElection(record) }));
  }
  if (method === "GET" && path === "/api/10x/transparency/policies") return json(await envelope(env, await publicPolicy()));
  if (method === "GET" && path === "/api/10x/research/signals") return json(await envelope(env, await signalResearch(env.TENX_DB)));
  if(method==="GET"&&path==="/api/10x/research/scores")return json(await envelope(env,await scoreResearch(env.TENX_DB,new Date(),ScoreModelSchema.parse(url.searchParams.get("model")??"discovery-score-v1"),researchMode(env))));
  if(method==="GET"&&path==="/api/10x/research/scores/followup")return json(await envelope(env,await scoreFollowupPlan(env.TENX_DB,z.enum(["dexscreener","geckoterminal"]).parse(env.TENX_MARKET_PROVIDER),env.TENX_MARKET_ENABLED==="true")));
  const scoreResearchEvidence=path.match(/^\/api\/10x\/research\/scores\/solana\/([^/]+)$/);
  if(method==="GET"&&scoreResearchEvidence){
    const detail=await scoreResearchDetail(env.TENX_DB,Address.parse(scoreResearchEvidence[1]),ScoreModelSchema.parse(url.searchParams.get("model")??"discovery-score-v1"));
    return detail?json(detail):json({error:"score_cohort_not_found"},404);
  }
  const signalEvidence = path.match(/^\/api\/10x\/research\/signals\/solana\/([^/]+)\/([^/]+)$/);
  if (method === "GET" && signalEvidence) {
    const detail = await signalDetail(env.TENX_DB,Address.parse(signalEvidence[1]),SignalKind.parse(signalEvidence[2]));
    return detail ? json(detail) : json({ error: "signal_cohort_not_found" },404);
  }
  const policyRecord = path.match(/^\/api\/10x\/admin\/policies\/previews\/([^/]+)$/);
  if (method === "GET" && policyRecord) {
    const record = await policyPreviewRecord(env.TENX_DB, policyRecord[1]!);
    return record ? json({ record, replay: "verified" }) : json({ error: "policy_preview_not_found" }, 404);
  }
  if(method==="GET"&&path==="/api/10x/discovery/compare"){
    const query=z.object({addresses:z.string().max(134),mode:z.enum(["live","fixture"]).default("live")}).strict().parse(Object.fromEntries(url.searchParams));
    return json(await discoveryComparison(env.TENX_DB,ComparisonAddresses.parse(query.addresses.split(",")),query.mode));
  }
  if(method==="GET"&&path==="/api/10x/history")return json(await historyDirectory(env.TENX_DB,Object.fromEntries(url.searchParams)));
  if (method === "GET" && path === "/api/10x/candidates") {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      mode: z.enum(["live", "fixture"]).default("live"),
      status: z.enum(["all", "eligible", "provisional", "excluded"]).default("all"),
      age: z.enum(["all", "24h"]).default("all"),
      inventory:z.enum(["retained","current"]).default("retained"),
      view: z.enum(["full", "cards"]).default("full"),
      sort:z.enum(["score","liquidity"]).default("score"),
      browse:z.enum(["top100","inventory"]).default("top100"),
      q:z.string().trim().max(100).default(""),
      freshness:z.enum(["all","fresh","stale","missing"]).default("all"),
      min_liquidity:z.coerce.number().finite().min(0).max(1e12).default(0),
      min_coverage:z.coerce.number().finite().min(0).max(100).default(0),
      cursor: z.string().max(512).optional(),
    }).strict().parse(Object.fromEntries(url.searchParams));
    const {cursor:ignoredCursor,limit:ignoredLimit,...identityFields}=query;
    const identity=await hashJson(identityFields);
    const realNow=new Date();let at=realNow,offset=0,priorSnapshot:string|null=null;
    if (query.cursor) {
      let decoded: unknown;
      try { decoded = JSON.parse(atob(query.cursor)); } catch { return json({ error: "invalid_cursor" }, 400); }
      const cursor = z.object({ snapshot: z.string().regex(/^[a-f0-9]{64}$/), as_of:z.string().datetime(),offset: z.number().int().min(0).max(query.browse==="inventory"?500:100),identity:z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(decoded);
      if (cursor.identity!==identity||Date.parse(cursor.as_of)>realNow.getTime()||realNow.getTime()-Date.parse(cursor.as_of)>300000) return json({ error: "cursor_expired_refresh_required" }, 409);
      offset = cursor.offset;at=new Date(cursor.as_of);priorSnapshot=cursor.snapshot;
    }
    const stored=await scoreInventoryCandidates(env.TENX_DB,query.mode,query.age==="all"&&query.inventory==="retained");
    const retainedTotal=query.inventory==="current"?(await env.TENX_DB.prepare("SELECT count(*) AS n FROM tenx_candidates WHERE mode=?1").bind(query.mode).first<{n:number}>())!.n:undefined;
    const ranked=await rankedDiscovery(env.TENX_DB,query.age==="24h"?stored.filter(c=>createdWithinWindow(c,at)):stored,at,query.sort,query.status,
      {search:query.q,freshness:query.freshness,min_liquidity:query.min_liquidity,min_coverage:query.min_coverage,maximum:query.browse==="inventory"?500:100}),rows=ranked.rows;
    const snapshot=await hashJson({rows,stored:stored.length,matched:ranked.matched,observed:ranked.observed,counts:ranked.counts,...retainedTotal!==undefined?{retained_total:retainedTotal}:{}});
    if(priorSnapshot!==null&&priorSnapshot!==snapshot)return json({error:"cursor_expired_refresh_required"},409);
    const next = offset + query.limit;
    return json(await envelope(env, {
      candidates: query.view === "cards" ? rows.slice(offset, next).map(candidateCard) : rows.slice(offset, next), mode: query.mode,sort:query.sort,scored_at:at.toISOString(),observed:ranked.observed,
      counts:ranked.counts,
      scope:{inventory:query.age==="24h"?"active_verified_first_day":query.inventory==="current"?"current_evaluation":"retained",stored:stored.length,...retainedTotal!==undefined?{retained_total:retainedTotal}:{},ranked:ranked.ranked,matched:ranked.matched,available:rows.length,truncated:ranked.matched>rows.length,maximum:query.browse==="inventory"?500:100,search_before_limit:true},
    }, { next_cursor: next < rows.length ? btoa(JSON.stringify({ snapshot,as_of:at.toISOString(),offset: next,identity })) : null }));
  }
  const scorecard=path.match(/^\/api\/10x\/discovery\/scores\/solana\/([^/]+)$/);
  if(method==="GET"&&scorecard){
    const address=Address.parse(scorecard[1]),mode=z.enum(["live","fixture"]).parse(url.searchParams.get("mode")??"live");
    const record=await candidateScorecard(env.TENX_DB,address,mode);if(!record)return json({error:"candidate_not_found"},404);
    await replayAnyDiscoveryScore(record);return json({record,replay:"verified",provider_requests:0});
  }
  const activity = path.match(/^\/api\/10x\/activity\/solana\/([^/]+)$/);
  if (method === "GET" && activity) {
    const address = Address.parse(activity[1]), now = new Date();
    const saved = await env.TENX_DB.prepare("SELECT payload FROM tenx_candidates WHERE address=?1 AND mode='live'").bind(address).first<{payload:string}>();
    if (!saved) return json({error:"candidate_not_found"},404);
    const candidate=CandidateSchema.parse(JSON.parse(saved.payload));
    const evidence=candidate.wallet_analysis ? await d1EvidenceReadStore(env.TENX_DB).walletReceipt(candidate.wallet_analysis.evidence_hash,address) : null;
    const history=await env.TENX_DB.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 ORDER BY fetched_at DESC LIMIT 1000").bind(address,new Date(now.getTime()-86400000).toISOString()).all<{payload:string}>();
    return json(await envelope(env,await activitySummary(candidate,evidence?WalletEvidenceSchema.parse(JSON.parse(evidence.payload)):null,history.results.map(r=>MarketSchema.parse(JSON.parse(r.payload))),now)));
  }
  const detail = path.match(/^\/api\/10x\/candidates\/solana\/([^/]+)$/);
  if (method === "GET" && detail) {
    const address = Address.parse(detail[1]);
    const mode = z.enum(["live", "fixture"]).parse(url.searchParams.get("mode") ?? "live");
    const stored = await env.TENX_DB.prepare("SELECT payload FROM tenx_candidates WHERE address=?1 AND mode=?2").bind(address, mode).first<{ payload: string }>();
    if (!stored) return json({ error: "candidate_not_found" }, 404);
    const candidate = assess(CandidateSchema.parse(JSON.parse(stored.payload)), DEFAULT_POLICY, new Date());
    return json(await envelope(env, candidate, { retention:mode === "live" ? await candidateExpiry(env.TENX_DB,address) : null }));
  }
  const evidence = path.match(/^\/api\/10x\/evidence\/([^/]+)$/);
  if (method === "GET" && evidence) {
    const signature = Signature.parse(evidence[1]);
    const row = await env.TENX_DB.prepare("SELECT payload_hash,payload,fetched_at FROM tenx_evidence WHERE signature=?1").bind(signature).first<{ payload_hash: string; payload: string; fetched_at: string }>();
    return row ? json(await envelope(env, { ...row, payload: JSON.parse(row.payload) })) : json({ error: "evidence_not_found" }, 404);
  }
  const accountEvidence = path.match(/^\/api\/10x\/account-evidence\/([a-f0-9]{64})$/);
  if (method === "GET" && accountEvidence) {
    const row = await env.TENX_DB.prepare("SELECT address,slot,payload,observed_at FROM tenx_account_evidence WHERE payload_hash=?1").bind(accountEvidence[1]!).first<{ address: string; slot: number; payload: string; observed_at: string }>();
    return row ? json(await envelope(env, { ...row, payload_hash: accountEvidence[1], payload: JSON.parse(row.payload) })) : json({ error: "evidence_not_found" }, 404);
  }
  const walletEvidence = path.match(/^\/api\/10x\/wallet-evidence\/([a-f0-9]{64})$/);
  if (method === "GET" && walletEvidence) {
    const row = await d1EvidenceReadStore(env.TENX_DB).walletReceipt(walletEvidence[1]!);
    return row ? json(await envelope(env, { address: row.address, payload_hash: walletEvidence[1], observed_at: row.observed_at, payload: JSON.parse(row.payload) })) : json({ error: "evidence_not_found" }, 404);
  }
  const walletProfiles = path.match(/^\/api\/10x\/wallets\/solana\/([^/]+)$/);
  if (method === "GET" && walletProfiles) {
    const wallet = Address.parse(walletProfiles[1]);
    const rows = await env.TENX_DB.prepare("SELECT address,payload_hash,payload,observed_at FROM tenx_wallet_profiles WHERE wallet=?1 ORDER BY observed_at DESC LIMIT 20").bind(wallet).all<{ address: string; payload_hash: string; payload: string; observed_at: string }>();
    return json(await envelope(env, { wallet, scope: "local_observed_tokens_only", profiles: rows.results.map(row => ({ ...row, payload: JSON.parse(row.payload) })) }));
  }
  const holderEvidence = path.match(/^\/api\/10x\/holder-evidence\/([a-f0-9]{64})$/);
  if (method === "GET" && holderEvidence) {
    const row = await d1EvidenceReadStore(env.TENX_DB).holderReceipt(holderEvidence[1]!);
    return row ? json(await envelope(env, { address:row.address,slot:row.slot,payload:JSON.parse(row.payload),observed_at:row.observed_at,payload_hash:holderEvidence[1] })) : json({ error: "evidence_not_found" }, 404);
  }
  const history = path.match(/^\/api\/10x\/history\/solana\/([^/]+)$/);
  if (method === "GET" && history) {
    const address = Address.parse(history[1]);
    const query = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).strict().parse(Object.fromEntries(url.searchParams));
    const rows = await env.TENX_DB.prepare("SELECT payload FROM tenx_market_history WHERE address=?1 AND fetched_at>=?2 ORDER BY fetched_at DESC LIMIT 1000").bind(address, new Date(Date.now() - query.hours * 3600000).toISOString()).all<{ payload: string }>();
    const points = rows.results.reverse().map(row => MarketSchema.parse(JSON.parse(row.payload))), sources = [...new Set(points.map(p => p.source))];
    return json(await envelope(env, { address, source: sources.length > 1 ? "mixed" : sources[0] ?? env.TENX_MARKET_PROVIDER, coverage: "local_observations_only", points }));
  }
  if (method === "GET" && path === "/api/10x/research/reviews") {
    const rows = await env.TENX_DB.prepare(`SELECT payload FROM (SELECT payload,day,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at DESC,input_hash) AS position FROM tenx_reviews) WHERE position=1 ORDER BY day DESC LIMIT 7`).all<{ payload: string }>();
    const day = researchDay(new Date());
    const collected = await env.TENX_DB.prepare("SELECT COUNT(*) AS tokens,MAX(selected_at) AS last_snapshot_at FROM tenx_cohorts WHERE day=?1").bind(day).first<{ tokens: number; last_snapshot_at: string | null }>();
    const recommendations = await env.TENX_DB.prepare("SELECT COUNT(*) AS count FROM tenx_selections WHERE day=?1").bind(day).first<{ count: number }>();
    const wallets = await env.TENX_DB.prepare("SELECT COUNT(*) AS count FROM tenx_wallet_cohorts WHERE day=?1").bind(day).first<{ count: number }>();
    return json(await envelope(env, { reports: rows.results.map(row => JSON.parse(row.payload)), automatic_policy_changes: false, collection: { day, tokens: collected?.tokens ?? 0, recommended: recommendations?.count ?? 0, wallet_samples: wallets?.count ?? 0, last_snapshot_at: collected?.last_snapshot_at ?? null } }));
  }
  const marketBatch=path.match(/^\/api\/10x\/admin\/market\/batches\/(latest|latest_issue)$/);
  if(method==="GET"&&marketBatch){const saved=await marketBatchRecord(env.TENX_DB,marketBatch[1] as "latest"|"latest_issue");return saved?json(saved):json({error:"market_batch_not_found"},404);}
  if (method === "GET" && path === "/api/10x/admin/jobs") {
    const jobs = await env.TENX_DB.prepare("SELECT * FROM tenx_jobs ORDER BY started_at DESC LIMIT 30").all();
    const runs = await env.TENX_DB.prepare("SELECT id,json_extract(summary,'$.input_hash') AS input_hash,created_at FROM tenx_election_runs ORDER BY created_at DESC LIMIT 10").all();
    return json(await envelope(env, { ...await status(env), jobs: jobs.results, dry_runs: runs.results }));
  }
  if (method === "POST" && admin) {
    const body = await adminJson(request);
    if(path==="/api/10x/admin/launches/lab")return json({record:await createLaunch(env.TENX_DB,body),replay:"verified"});
    if(path==="/api/10x/admin/launches/recovery-lab")return json({record:await createRecovery(env.TENX_DB,body),replay:"verified"});
    const reason = z.object({ reason: z.string().min(3).max(300) }).passthrough().parse(body).reason;
    if(path==="/api/10x/admin/discovery/attention/collect")return json(await collectAttention(gmgnSettings(env),body,attentionFetcher(env)));
    if(path==="/api/10x/admin/discovery/attention/review")return json(await reviewAttention(gmgnSettings(env),body,attentionFetcher(env)));
    if(path==="/api/10x/admin/discovery/attention/candles")return json(await collectAttentionCandles(gmgnSettings(env),body,gmgnFetcher(env)));
    if(path==="/api/10x/admin/discovery/attention/traders")return json(await collectAttentionTraders(gmgnSettings(env),body,gmgnFetcher(env)));
    if(path==="/api/10x/admin/discovery/attention/activity")return json(await collectAttentionActivity(gmgnSettings(env),body,gmgnFetcher(env)));
    if(path==="/api/10x/admin/score-read-model"){
      z.object({reason:z.string().min(3).max(300)}).strict().parse(body);
      return json(await buildScoreReadModel(env.TENX_DB));
    }
    if(path==="/api/10x/admin/score-read-pages"){
      z.object({reason:z.string().min(3).max(300)}).strict().parse(body);
      return json(await buildScoreReadPages(env.TENX_DB));
    }
    if (path === "/api/10x/admin/gmgn/review") return json(await runGmgnReview(gmgnSettings(env), body, gmgnFetcher(env)));
    if (path === "/api/10x/admin/discovery/shortlist-query") return json(await runShortlistQuery(gmgnSettings(env), body, async (url, init) => {
      const target = new URL(url);
      if(target.pathname==="/v1/market/hot_searches"||target.pathname==="/api/v2/networks/trending_pools"||/^\/tokens\/v1\/(base|bsc|robinhood)\//.test(target.pathname))return attentionFetcher(env)(url,init);
      if (target.origin === "https://openapi.gmgn.ai") return gmgnFetcher(env)(url, init);
      if (env.TENX_NODE_RELAY === "true" && target.origin === "https://api.dexscreener.com") return fetch(`http://127.0.0.1:8795/dex/tokens/${target.pathname.split("/").at(-1)}`, {
        ...init, headers: { "x-tenx-local-relay": env.TENX_ADMIN_TOKEN }, redirect: "manual", credentials: "omit" });
      if (env.TENX_NODE_RELAY === "true" && target.origin === "https://api.geckoterminal.com") return fetch(`http://127.0.0.1:8795/market/trending/${target.searchParams.get("duration")}/${target.searchParams.get("page")}`, {
        ...init, headers: { "x-tenx-local-relay": env.TENX_ADMIN_TOKEN }, redirect: "manual", credentials: "omit" });
      return fetch(url, init);
    }));
    if(path==="/api/10x/admin/gmgn/event-sample/collect"){const input=z.object({activity_id:z.uuid(),reason:z.string().min(3).max(300)}).strict().parse(body);return json(await collectGmgnEventSample(settings(env),input.activity_id));}
    if(path==="/api/10x/admin/gmgn/corroboration/collect"){const input=z.object({activity_id:z.uuid(),reason:z.string().min(3).max(300)}).strict().parse(body);return json(await collectGmgnCorroboration(settings(env),input.activity_id));}
    if(path==="/api/10x/admin/mint-reviews")return json(await enqueueMintReview(env.TENX_DB,body));
    if (path === "/api/10x/admin/rewards/lab") return json({ record: await createRewards(env.TENX_DB, body), replay: "verified" });
    if (path === "/api/10x/admin/backing/open") return json(await openBacking(env.TENX_DB,body));
    if (path === "/api/10x/admin/backing/freeze") {
      const input=z.object({reason:z.string().min(3).max(300),request_id:z.uuid()}).strict().parse(body);
      return json(await freezeBacking(env.TENX_DB,input.request_id));
    }
    if(path==="/api/10x/admin/watchdog"){
      const input=z.object({reason:z.string().min(3).max(300),report:WatchdogReportSchema}).strict().parse(body);
      return json(await recordWatchdog(env.TENX_DB,input.report));
    }
    if (path === "/api/10x/admin/maintenance" || path === "/api/10x/admin/review") {
      const now = new Date(), state = await control(env.TENX_DB);
      await env.TENX_DB.prepare("UPDATE tenx_control SET heartbeat_at=?1 WHERE id=1").bind(now.toISOString()).run();
      const inventory = await expireCandidates(env.TENX_DB,now);
      const diagnostics = await runSignalCycle(env.TENX_DB);
      const gmgn_planned = await gmgnPilotHasCapacity(gmgnSettings(env));
      const score_research=await runScoreResearch(env.TENX_DB,undefined,gmgn_planned?2:3,researchMode(env));
      const backing_index=await runBackingIndex(settings(env));
      const backing = await settleBacking(env.TENX_DB,new Date());
      let election: { id?: string; state: string; error?: string };
      try { election = await dailyElection(env.TENX_DB); }
      catch (error) { election = { state: "failed", error: error instanceof ElectionError ? error.message : "election_unavailable" }; }
      await env.TENX_DB.prepare("UPDATE tenx_control SET election_error=?1 WHERE id=1").bind(election.error ?? null).run();
      // Allocate at most one of the existing three capture slots to this small
      // pilot, so a busy score queue cannot permanently starve source research.
      // A failed/waiting score pass cannot spend a further capture slot.
      let gmgn;
      try { gmgn = await runGmgnPilot(gmgnSettings(env), score_research.state === "succeeded" && "attempted" in score_research ? score_research.attempted ?? 3 : 3, gmgnFetcher(env)); }
      catch { gmgn = { state: "failed", reason: "gmgn_pilot_unavailable", provider_requests: 0 }; }
      if (path.endsWith("/review") || !state.reviewed_at || now.getTime() - Date.parse(state.reviewed_at) >= 3600000) {
        const review = await runReviews(env.TENX_DB, now);
        await env.TENX_DB.prepare("UPDATE tenx_control SET reviewed_at=?1 WHERE id=1").bind(now.toISOString()).run();
        return json({ local: true, review, election, diagnostics, score_research, gmgn, backing, backing_index, inventory });
      }
      return json({ local: true, review: "waiting_for_hourly_tick", election, diagnostics, score_research, gmgn, backing, backing_index, inventory });
    }
    if (path === "/api/10x/admin/refresh") {
      await audit(env.TENX_DB, "refresh_requested", reason, {});
      const force = z.object({ force: z.boolean().default(false) }).passthrough().parse(body).force;
      return json(await runCycle({ ...settings(env), paced: !force }));
    }
    if (path === "/api/10x/admin/market-refresh") return json(await runMarketCycle(settings(env)));
    if (path === "/api/10x/admin/wallet-replay") {
      await audit(env.TENX_DB,"cached_wallet_replay_requested",reason,{});
      return json(await replayLegacyWallets(env.TENX_DB));
    }
    if (path === "/api/10x/admin/artwork-refresh") return json(await runArtworkCycle(settings(env)));
    if (path === "/api/10x/admin/quality-refresh") return json(await runQualityCycle(settings(env)));
    if (path === "/api/10x/admin/wallet-refresh") {
      const query = z.object({ address: Address.optional() }).passthrough().parse(body);
      await audit(env.TENX_DB, "wallet_refresh_requested", reason, { address: query.address ?? "next_due_candidate" });
      return json(await runWalletCycle(settings(env), query.address));
    }
    if (path === "/api/10x/admin/pause") {
      const paused = z.object({ paused: z.boolean() }).passthrough().parse(body).paused;
      await audit(env.TENX_DB, paused ? "pause" : "resume", reason, { paused });
      await env.TENX_DB.prepare("UPDATE tenx_control SET paused=?1 WHERE id=1").bind(paused ? 1 : 0).run();
      return json({ paused });
    }
    if (path === "/api/10x/admin/seed-fixtures") {
      for (const candidate of await fixtureCandidates()) await saveCandidate(env.TENX_DB, candidate);
      await audit(env.TENX_DB, "seed_fixtures", reason, { mode: "fixture" });
      return json({ mode: "fixture", seeded: 4 });
    }
    if (path === "/api/10x/admin/dry-run") {
      const { request_id } = z.object({ request_id: z.uuid().optional() }).passthrough().parse(body);
      return json(await dryRun(env.TENX_DB, undefined, request_id, reason));
    }
    if (path === "/api/10x/admin/policies/preview") {
      return json({ record: await createPolicyPreview(env.TENX_DB, body), replay: "verified" });
    }
  }
  return json({ error: "not_found" }, 404);
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await handle(request, env); }
    catch (error) {
      if (error instanceof ContentError || error instanceof IdentityError) {
        const response = json({ error: error.message }, error.status); response.headers.set("vary", "Cookie"); return response;
      }
      if (error instanceof RequestSecurityError) return json({ error: error.message }, error.status);
      if(error instanceof MintReviewError)return json({error:error.message},error.status);
      if(error instanceof DiscoveryScoreError)return json({error:error.message},503);
      if(error instanceof ScoreResearchError)return json({error:error.message},503);
      if(error instanceof HolderHistoryError)return json({error:error.message},503);
      if(error instanceof HolderAcquisitionError)return json({error:error.message},503);
      if(error instanceof LaunchError)return json({error:error.message},error.status);
      if(error instanceof RecoveryError)return json({error:error.message},error.status);
      if (error instanceof RewardError) return json({ error: error.message }, error.message === "reward_daily_limit" ? 429 : error.message === "reward_request_conflict" ? 409 : error.message.includes("mismatch") ? 503 : 400);
      if(error instanceof BackingError)return json({error:error.message},error.status);
      if(error instanceof OperationsError)return json({error:error.message},503);
      if (error instanceof SignalResearchError) return json({ error: error.message },503);
      if (error instanceof PolicyPreviewError) return json({ error: error.message }, error.message === "policy_preview_daily_limit" ? 429 : error.message === "policy_preview_request_conflict" ? 409 : error.message.startsWith("policy_preview_cannot") || error.message === "policy_evidence_gates_locked" ? 400 : 503);
      if (error instanceof ElectionError) return json({ error: error.message }, 503);
      if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "invalid_request_or_data" }, 400);
      console.error(JSON.stringify({ event: "tenx_request_failed", trace_id: crypto.randomUUID() }));
      return json({ error: "discovery_unavailable" }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
