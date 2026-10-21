import { writeFileSync } from "node:fs";
import {DiscoveryComparison} from "../discovery/src/discovery-comparison-model";
import {ActivityObservation} from "../discovery/src/activity-observation";
import attentionPaths from "../discovery/openapi-attention-paths.json";
import { z } from "zod";
import { GmgnPublicSummarySchema } from "../discovery/src/gmgn-model";
import { HolderHistoryReportSchema } from "../discovery/src/holder-history-model";
import { HolderAcquisitionReportSchema } from "../discovery/src/holder-acquisition-model";
import{GmgnCorroborationReportSchema}from"../discovery/src/gmgn-corroboration-model";
import{GmgnQuoteReportSchema}from"../discovery/src/gmgn-quote-model";
import { GmgnReviewRequestSchema } from "../discovery/src/gmgn";
import { InboxRecoveryResponse } from "../discovery/src/inbox-recovery-model";
import { MintReviewsResponse, MintReviewRequest } from "../discovery/src/mint-review-model";
import {MarketBatchDetailSchema} from "../discovery/src/market-batch-model";
import {AnyScoreResponseSchema as ScoreResponseSchema} from "../discovery/src/discovery-score-models";
import {ContentReportPage,ContentReportRecord,ContentReportRequest,ContentReportReviewRequest} from "../discovery/src/content-report-model";
import {HoldReviewPage,HoldReviewRecord,HoldReviewRequest,HoldReviewReply} from "../discovery/src/content-hold-model";
import {ContentOperations} from "../discovery/src/content-operations-model";
import { CardListResponse } from "../app/src/discovery/client";
import { RewardList, RewardRecord, RewardRequest } from "../discovery/src/reward-model";
import {RecoveryList,RecoveryRecord,RecoveryRequest} from "../discovery/src/launch-recovery-model";
import { LaunchList, LaunchRecord, LaunchRequest } from "../discovery/src/launch-model";
import { ContentAppealRequest, ContentCampaign, ContentCampaignDetail, ContentCampaignList, ContentCampaignRequest, ContentChangeResponse, ContentPage, ContentRecord, ContentReviewRequest, ContentSubmissionRequest } from "../discovery/src/content-model";
import { AssessedCandidateSchema, PolicySchema, ProofSchema } from "../discovery/src/model";
import { ArtworkResponseSchema } from "../discovery/src/artwork-model";
import { WalletWorkResponseSchema } from "../discovery/src/wallet-work-model";
import { WalletPlansResponseSchema } from "../discovery/src/wallet-plan-model";
import { PolicyEditsSchema, PolicyPreviewResponseSchema, PreviewRequestSchema } from "../discovery/src/policy-model";
import { SignalDetailSchema } from "../discovery/src/signal-model";
import {ScoreResearchDetailSchema} from "../discovery/src/score-research-model";
import {ScoreResearchResponse} from "../app/src/discovery/client";
import {ScoreFollowupResponse} from "../app/src/discovery/client";
import { OperationsSchema, WatchdogReportSchema } from "../discovery/src/operations-model";
import { IdentityChallengeRequest, IdentityChallengeResponse, IdentitySessionResponse, IdentityVerifyRequest } from "../discovery/src/identity-model";
import { OpenBackingRequest, BackingListResponse, BackingSummary, BackingRecord } from "../discovery/src/backing-model";
import { ActivityResponse, CoverageResponse, DetailResponse, ElectionDetailResponse, ElectionsResponse, HistoryResponse, ListResponse, PoliciesResponse, ReviewsResponse, SignalsResponse, StatusResponse } from "../app/src/discovery/client";

const ok = { description: "Success; cached public data includes timestamps, source freshness and coverage", content: { "application/json": { schema: { type: "object" } } } };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 429, 503].map(code => [code, { description: "Structured JSON error; no provider secrets" }]));
const read = (summary: string, extra: object = {}) => ({ get: { summary, responses: { 200: ok, ...errors }, ...extra } });
const responseSchema = (name: string) => ({ responses: { 200: { ...ok, content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } } }, ...errors } });
const candidateResponses = { responses: { 200: { ...ok, content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/CandidateListResponse" }, { $ref: "#/components/schemas/CandidateCardsResponse" }] } } } }, ...errors } };
const reason = { type: "string", minLength: 3, maxLength: 300 };
const post = (summary: string, properties: object = {}, required: string[] = []) => ({ post: { summary, security: [{ localOperator: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { reason, ...properties }, required: ["reason", ...required] } } } }, responses: { 200: ok, ...errors } } });
const parameter = (name: string, where: "query" | "path", schema: object, required = false) => ({ name, in: where, required, schema });
const identityPost = (summary: string, requestSchema: object, response: string) => ({ post: {
  summary, description: "Local-only browser flow. Exact allowlisted Origin, application/json and X-Tenx-Identity: 1 required. HttpOnly browser session and single-use challenge bind verification. No RPC, transactions, votes or operator token.",
  parameters: [parameter("X-Tenx-Identity", "header", { const: "1" }, true), parameter("Origin", "header", { type: "string" }, true)],
  requestBody: { required: true, content: { "application/json": { schema: requestSchema } } }, ...responseSchema(response),
} });
const spec = {
  openapi: "3.1.0", info: { title: "10X local Solana discovery", version: "0.1.0", description: "Local-only chain discovery and signed-message wallet ownership. No server-held signers, transactions, votes, launches or financial flows. Public reads use stored data; only authenticated refresh makes provider requests." },
  servers: [{ url: "http://127.0.0.1:8794" }],
  paths: {
    "/api/10x/discovery/compare":read("Cache-only comparison of up to three unique saved mints at one review cutoff; actual source windows differ, current v4 unchanged",{...responseSchema("DiscoveryComparison"),parameters:[parameter("addresses","query",{type:"string",maxLength:134,description:"One to three unique comma-separated exact Solana mints; no provider lookup"},true),parameter("mode","query",{enum:["live","fixture"],default:"live"})]}),
    "/api/10x/gmgn/quote/{id}":read("Cache-only saved quote transfers and fee-basis review; no historical USD or organic credit",{...responseSchema("GmgnQuoteReview"),parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/gmgn/quote/{id}":read("Private source-plus-RPC quote review replay; no provider calls or database writes",{security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/gmgn/corroboration/{id}":read("Cache-only RPC comparison of saved GMGN events; no volume or action certification",{...responseSchema("GmgnRpcComparison"),parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/gmgn/corroboration/{id}":read("Private frozen source and transaction comparison inputs",{security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/gmgn/corroboration/collect":post("Explicit at-most-two transaction collection through existing wallet RPC quotas and lease; no action credit"),
    "/api/10x/admin/gmgn/activity-target/{id}":read("Private cache-only deterministic largest-flow wallet plan; no provider IO",{security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/holders/acquisition/solana/{address}":read("Cached signed-buy matching for raw entrants; sample evidence with qualified growth held",{...responseSchema("HolderAcquisitionReport"),parameters:[parameter("address","path",{type:"string"},true)]}),
    "/api/10x/admin/holders/acquisition/solana/{address}":read("Private acquisition inputs and replayable report; no source IO or database writes",{security:[{localOperator:[]}],parameters:[parameter("address","path",{type:"string"},true)]}),
    "/api/10x/holders/history/solana/{address}":read("Hash-verified raw owner changes from cached full inventories; no qualified growth or provider IO",{...responseSchema("HolderHistoryReport"),parameters:[parameter("address","path",{type:"string"},true)]}),
    "/api/10x/admin/holders/history/solana/{address}":read("Private frozen inputs and raw owner history report for offline replay; no IO/writes",{security:[{localOperator:[]}],parameters:[parameter("address","path",{type:"string"},true)]}),
    "/api/10x/attention/reports":{post:{...identityPost("Private good-faith concern about a visible link; does not hide it or establish the claim",{$ref:"#/components/schemas/ContentReportRequest"},"ContentReportRecord").post,security:[{localIdentity:[]}] }},
    "/api/10x/attention/reports/mine":read("Signed reporter-only claims; private explanations and cursor pagination",{...responseSchema("ContentReportPage"),security:[{localIdentity:[]}],parameters:[parameter("cursor","query",{type:"string",maxLength:100})]}),
    "/api/10x/attention/reports/{id}":read("Reporter-only retained report history and hash verification",{...responseSchema("ContentReportRecord"),security:[{localIdentity:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/attention/reports":read("Operator-only report queue; allegations do not auto-hide content",{...responseSchema("ContentReportPage"),security:[{localOperator:[]}],parameters:[parameter("status","query",{enum:["OPEN","UPHELD","DISMISSED","RELEASED"]}),parameter("cursor","query",{type:"string",maxLength:100})]}),
    "/api/10x/admin/attention/reports/{id}":read("Operator-only private report history and replay",{...responseSchema("ContentReportRecord"),security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/attention/reports/review":{post:{...post("Uphold/dismiss a claim or release its independent visibility hold; revision-bound, audit-linked, no reward credit").post,...responseSchema("ContentReportRecord"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/ContentReportReviewRequest"}}}}}},
    "/api/10x/admin/attention/operations": read("Operator-only aggregate backlog, observed UTC quota usage and bounded payload-size samples; no raw private content or provider calls",{...responseSchema("ContentOperations"),security:[{localOperator:[]}]}),
    "/api/10x/attention/hold-reviews": {post:{...identityPost("Owner-only private follow-up for held content; bound to verified hold set, no reporter details or automatic release",{$ref:"#/components/schemas/HoldReviewRequest"},"HoldReviewRecord").post,security:[{localIdentity:[]}]}},
    "/api/10x/attention/hold-reviews/mine": read("Owner-only contributor conversations; 20 per page, no complaint details",{...responseSchema("HoldReviewPage"),security:[{localIdentity:[]}],parameters:[parameter("cursor","query",{type:"string",maxLength:100})]}),
    "/api/10x/attention/hold-reviews/{id}": read("Owner-only hash-verified conversation and current independent hold state",{...responseSchema("HoldReviewRecord"),security:[{localIdentity:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/attention/hold-reviews/respond": {post:{...identityPost("One contributor response after a moderator requests information; revision and session guarded",{$ref:"#/components/schemas/HoldReviewReply"},"HoldReviewRecord").post,security:[{localIdentity:[]}]}},
    "/api/10x/admin/attention/hold-reviews": read("Private contributor review queue; separate from original complaints and hold decisions",{...responseSchema("HoldReviewPage"),security:[{localOperator:[]}],parameters:[parameter("status","query",{enum:["OPEN","NEEDS_INFO","RESUBMITTED","CLOSED"]}),parameter("cursor","query",{type:"string",maxLength:100})]}),
    "/api/10x/admin/attention/hold-reviews/{id}": read("Operator-only verified contributor conversation; replies visible to contributor",{...responseSchema("HoldReviewRecord"),security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/attention/hold-reviews/review": {post:{...post("Request one additional response or close conversation; no original report/visibility writes").post,...responseSchema("HoldReviewRecord"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/HoldReviewReply"}}}}}},
    "/api/10x/discovery/inbox-recovery": read("Cached version-upgrade migration recheck receipts and daily subset; zero source calls, no eligibility changes",responseSchema("InboxRecoveryResponse")),
    "/api/10x/discovery/mint-reviews": read("Cached exact-mint review progress; zero source calls; migration admission is not eligibility",responseSchema("MintReviewsResponse")),
    "/api/10x/admin/mint-reviews": {post:{...post("Queue one exact Solana mint for the existing paced collector; idempotent, bounded, no immediate provider requests").post,requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/MintReviewRequest"}}}}}},
    "/api/10x/attention/campaigns": read("Local ten-day content review campaigns; no real launch or reward budget", { ...responseSchema("ContentCampaignList"), parameters: [parameter("cursor", "query", { type: "string", maxLength: 100 })] }),
    "/api/10x/attention/campaigns/{id}": read("Public reviewed links only; no contributor identity, private moderation reason or pending content", { ...responseSchema("ContentCampaignDetail"), parameters: [parameter("id", "path", { type: "string", format: "uuid" }, true), parameter("cursor", "query", { type: "string", maxLength: 100 })] }),
    "/api/10x/attention/mine": read("Private submissions for the signed Solana browser session; cursor pagination, 20 per page", { ...responseSchema("ContentPage"), security: [{ localIdentity: [] }], parameters: [parameter("cursor", "query", { type: "string", maxLength: 100 })] }),
    "/api/10x/attention/mine/{id}": read("Owner-only hash-linked review history; no social authorship or metrics verification", { ...responseSchema("ContentRecord"), security: [{ localIdentity: [] }], parameters: [parameter("id", "path", { type: "string", format: "uuid" }, true)] }),
    "/api/10x/attention/submissions": {post:{ ...identityPost("Submit a public HTTPS URL with rights/feature consent; signed identity, CSRF and 4 KB body bound", {$ref:"#/components/schemas/ContentSubmissionRequest"}, "ContentRecord").post, security:[{localIdentity:[]}] }},
    "/api/10x/attention/appeals": {post:{ ...identityPost("Owner appeal of a flagged/rejected revision; does not restore visibility or create rewards", {$ref:"#/components/schemas/ContentAppealRequest"}, "ContentChangeResponse").post, security:[{localIdentity:[]}] }},
    "/api/10x/admin/attention/campaigns": {post:{ ...post("Open an immutable local review window for exactly ten days; at most ten open, no live spotlight").post, ...responseSchema("ContentCampaign"), requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/ContentCampaignRequest"}}}} }},
    "/api/10x/admin/attention/queue": read("Operator-only moderation queue; optional status filter and bounded cursor", { ...responseSchema("ContentPage"), security:[{localOperator:[]}], parameters:[parameter("status","query",{enum:["PENDING","VISIBLE","FLAGGED","REJECTED","APPEALED"]}), parameter("cursor","query",{type:"string",maxLength:100})] }),
    "/api/10x/admin/attention/review": {post:{ ...post("Append an optimistic-concurrency moderation decision and audit hash atomically; visibility is not authorship/reward verification").post, ...responseSchema("ContentChangeResponse"), requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/ContentReviewRequest"}}}} }},
    "/api/10x/admin/attention/submissions/{id}": read("Operator-only full review history and deterministic hash verification", { ...responseSchema("ContentRecord"), security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)] }),
    "/api/10x/rewards/lab": read("Latest five hypothetical attention scenarios; hash-checked aggregates, no participant inputs or provider requests", responseSchema("RewardList")),
    "/api/10x/launches/recovery-lab": read("Latest five immutable hypothetical recovery exercises; no real transaction or publication",responseSchema("RecoveryList")),
    "/api/10x/admin/launches/recovery-lab": {post:{...post("Save/replay a bounded offline recovery exercise; ten new exercises per UTC day; no execution journal or signer").post,...responseSchema("RecoveryResponse"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/RecoveryRequest"}}}}}},
    "/api/10x/admin/launches/recovery-lab/{id}": read("Private full recovery scenario and deterministic replay",{...responseSchema("RecoveryResponse"),security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/launches/lab": read("Latest five versioned hypothetical three-pool curve, fee, funded-route, cycle or timed-fee rehearsals; no execution, signing or provider requests",responseSchema("LaunchList")),
    "/api/10x/admin/launches/lab": {post:{...post("Freeze and replay versioned curve, static fee, funded route, independent cycle or linear opening-fee math; fixed 50/20/20/10, shared twenty scenarios per UTC day, no launch authority").post,...responseSchema("LaunchResponse"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/LaunchRequest"}}}}}},
    "/api/10x/admin/launches/lab/{id}": read("Operator-only frozen assumptions and deterministic curve replay",{...responseSchema("LaunchResponse"),security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/admin/rewards/lab": {post:{...post("Freeze and replay offline ten-day/ten-percent attention accounting; both unapproved boost options, 20 scenarios per UTC day, no claims").post,...responseSchema("RewardResponse"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/RewardRequest"}}}}}},
    "/api/10x/admin/rewards/lab/{id}": read("Operator-only frozen inputs, raw ranks and deterministic accounting replay; no provider requests", {...responseSchema("RewardResponse"),security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)]}),
    "/api/10x/backing": read("Latest ten local prospective backing experiments; hash-checked aggregates only, no wallet membership or RPC calls; all outcomes withheld",responseSchema("BackingListResponse")),
    "/api/10x/admin/backing/open": {post:{...post("Freeze up to 20 contenders under all current gates and signed wallet membership before a prospective window; one open, 20/day, explicit hypothetical USD assumptions").post,...responseSchema("BackingSummary"),requestBody:{required:true,content:{"application/json":{schema:{$ref:"#/components/schemas/OpenBackingRequest"}}}}}},
    "/api/10x/admin/backing/freeze": {post:{...post("After fixed end + five minute source deadline, freeze up to 100 cached finalized transaction bodies; no new provider requests or live votes").post,...responseSchema("BackingSummary"),requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["reason","request_id"],properties:{reason,request_id:{type:"string",format:"uuid"}}}}}}}},
    "/api/10x/admin/backing/{id}": read("Private immutable membership/transactions/ledger and deterministic decoder replay; operator only",{security:[{localOperator:[]}],parameters:[parameter("id","path",{type:"string",format:"uuid"},true)],responses:{200:{...ok,content:{"application/json":{schema:{type:"object",required:["record","replay"],properties:{record:{$ref:"#/components/schemas/BackingRecord"},replay:{const:"verified"}}}}}},...errors}}),
    "/api/10x/identity/session": read("Current local Solana identity and linked wallets; HttpOnly cookie, no provider calls; separate from Warplets/Farcaster", responseSchema("IdentitySessionResponse")),
    "/api/10x/identity/challenge": identityPost("Issue exact domain/address/chain/intent/browser-bound 5-minute challenge; 10 per browser/minute, 500 globally per UTC day", { $ref: "#/components/schemas/IdentityChallengeRequest" }, "IdentityChallengeResponse"),
    "/api/10x/identity/verify": identityPost("Verify exact stored message with strict Ed25519; atomic consumption, ownership, rotation and audit. Signed unlink revokes every identity session; last wallet is retained", { $ref: "#/components/schemas/IdentityVerifyRequest" }, "IdentitySessionResponse"),
    "/api/10x/identity/logout": identityPost("Revoke this browser session and its outstanding challenges; retain wallet links", { type: "object", additionalProperties: false, maxProperties: 0 }, "IdentitySessionResponse"),
    "/api/10x/health": read("Local service readiness"),
    "/api/10x/discovery/wallet-work": read("Cached resumable direct funding work; does not refresh wallet snapshots or waive eligibility gates", responseSchema("WalletWorkResponse")),
    "/api/10x/discovery/wallet-plan": read("Read-only funding plans for up to 20 current contenders and measured local collection yield; request estimates are lower bounds, zero provider calls and unchanged gates",responseSchema("WalletPlansResponse")),
    "/api/10x/artwork": read("Cached presentation artwork linked by saved verified Pump creation metadata; never changes eligibility or triggers provider calls", { ...responseSchema("ArtworkResponse"), parameters: [parameter("addresses", "query", { type: "string", description: "One to 100 comma-separated Solana mints" }, true)] }),
    "/api/10x/chains": read("Discovery capabilities, separate from launch support"),
    "/api/10x/candidates": read("Search/filter the full bounded inventory before the 100-result view; current v4 and action eligibility remain separate", { ...candidateResponses, parameters: [parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 25 }), parameter("mode", "query", { enum: ["live", "fixture"], default: "live" }), parameter("status", "query", { enum: ["all", "eligible", "provisional", "excluded"] }), parameter("age", "query", { enum: ["all", "24h"], default: "all", description: "24h requires independently verified token creation time; the Discover view uses 24h" }), parameter("view", "query", { enum: ["full", "cards"], default: "full", description: "Compact cards project after complete scoring and action assessment" }),parameter("sort","query",{enum:["score","liquidity"],default:"score"}), parameter("q","query",{type:"string",maxLength:100,description:"Case-insensitive name/symbol or case-sensitive exact mint, before display limiting"}),parameter("freshness","query",{enum:["all","fresh","stale","missing"],default:"all"}),parameter("min_liquidity","query",{type:"number",minimum:0,maximum:1e12,default:0,description:"Saved reported USD liquidity; use freshness separately"}),parameter("min_coverage","query",{type:"number",minimum:0,maximum:100,default:0}),parameter("cursor", "query", { type: "string", maxLength: 512, description: "Opaque cursor binds every filter, source/order, observation cutoff and view for five minutes; 409 requires refresh" })] }),
    "/api/10x/discovery/scores/solana/{address}":read("Versioned replayable 0–100 discovery scorecard with full cached inputs, evidence coverage, risk ceilings and unknown/stale criteria; no provider requests or gate changes",{...responseSchema("DiscoveryScoreResponse"),parameters:[parameter("address","path",{type:"string",minLength:32,maxLength:44},true),parameter("mode","query",{enum:["live","fixture"],default:"live"})]}),
    "/api/10x/discovery/coverage": read("Cached progress toward ten eligible tokens, actual 24h coverage and blocking evidence gaps; target never waives a gate", responseSchema("CoverageResponse")),
    "/api/10x/activity/solana/{address}": read("Cached network fees, event/execution-reconciled Pump/PumpSwap trading fee components and price steps; organic activity remains unverified and fee coverage gaps stay explicit", {...responseSchema("ActivityResponse"),parameters:[parameter("address","path",{type:"string",minLength:32,maxLength:44},true)]}),
    "/api/10x/candidates/solana/{address}": read("Candidate identity, separate origin/migration proofs and risk", { ...responseSchema("CandidateDetailResponse"), parameters: [parameter("address", "path", { type: "string", minLength: 32, maxLength: 44 }, true), parameter("mode", "query", { enum: ["live", "fixture"] })] }),
    "/api/10x/evidence/{signature}": read("Saved normalized RPC transaction and SHA-256 evidence hash", { parameters: [parameter("signature", "path", { type: "string", minLength: 64, maxLength: 88 }, true)] }),
    "/api/10x/account-evidence/{hash}": read("Saved finalized mint, pool, vault and curve account snapshot", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/holder-evidence/{hash}": read("Replayable finalized owner inventory and reconciled mint supply", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/wallet-evidence/{hash}": read("Replayable finalized transaction sample, funding links, holder inputs and local outcome associations", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/wallets/solana/{address}": read("Cached wallet profiles across at most 20 locally analyzed tokens; incomplete lifetime coverage", { parameters: [parameter("address", "path", { type: "string", minLength: 32, maxLength: 44 }, true)] }),
    "/api/10x/history/solana/{address}": read("Saved local price and nullable market cap observations; no invented backfill", { ...responseSchema("HistoryResponse"), parameters: [parameter("address", "path", { type: "string" }, true), parameter("hours", "query", { type: "integer", minimum: 1, maximum: 168, default: 24 })] }),
    "/api/10x/research/reviews": read("Daily outcome reports, chronological holdout proposals and evidence-based wallet associations", responseSchema("ReviewsResponse")),
    "/api/10x/research/signals": read("Separate first-usable diagnostic cohorts, delayed 24h outcomes and time-purged holdout checks; latest 1000, no policy activation or provider calls",responseSchema("SignalsResponse")),
    "/api/10x/research/scores":read("Latest 500 prospective score observations and descriptive 24h outcome counts, including missingness; no automatic weight changes or provider calls",{...responseSchema("ScoreResearchResponse"),parameters:[parameter("model","query",{enum:["discovery-score-v1","discovery-score-v2","discovery-score-v3","discovery-score-v4"],default:"discovery-score-v1"})]}),
    "/api/10x/research/scores/followup":read("Cached endpoint follow-up readiness, next windows and holds; bounded allocation inside existing market batches, no requests triggered by this read",responseSchema("ScoreFollowupResponse")),
    "/api/10x/research/scores/solana/{address}":read("First retained scorecard per selected model and immutable replayable 24h outcome; legacy model default v1, no historical backfill",{...responseSchema("ScoreResearchDetailResponse"),parameters:[parameter("address","path",{type:"string",minLength:32,maxLength:44},true),parameter("model","query",{enum:["discovery-score-v1","discovery-score-v2","discovery-score-v3","discovery-score-v4"],default:"discovery-score-v1"})]}),
    "/api/10x/research/signals/solana/{address}/{signal}": read("Frozen diagnostic input, verified feature replay and hash-checked outcome; no provider calls",{...responseSchema("SignalDetailResponse"),parameters:[parameter("address","path",{type:"string",minLength:32,maxLength:44},true),parameter("signal","path",{enum:["new_token_high_cap","smooth_price_rise"]},true)]}),
    "/api/10x/elections": read("Latest ten immutable local discovery rehearsals; no community voting or launch authority", responseSchema("ElectionsResponse")),
    "/api/10x/elections/{id}": read("Frozen candidate inventory/policy and verified deterministic replay; zero provider requests", { ...responseSchema("ElectionDetailResponse"), parameters: [parameter("id", "path", { type: "string", pattern: "^(daily-[0-9]{4}-[0-9]{2}-[0-9]{2}|manual-[0-9a-f-]{36})$" }, true)] }),
    "/api/10x/system/status": read("Freshness, declared coverage gaps, UTC provider budgets and pauses", responseSchema("SystemStatusResponse")),
    "/api/10x/system/operations": read("Read-only local heartbeat, due collectors, source/budget states and independently retained watchdog transitions; zero provider calls",responseSchema("OperationsResponse")),
    "/api/10x/admin/watchdog": {post:{...post("Retain a recent local supervisor observation; monotonic latest report and transition-only history, no provider calls").post,requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["reason","report"],properties:{reason:{type:"string",minLength:3,maxLength:300},report:{$ref:"#/components/schemas/WatchdogReport"}}}}}}}},
    "/api/10x/transparency/policies": read("Actual local policy/hash, approval status, locked gates and separate review-only diagnostics", responseSchema("PoliciesResponse")),
    "/api/10x/admin/jobs": read("Restricted recent jobs and dry-run hashes", { security: [{ localOperator: [] }] }),
    "/api/10x/admin/market/batches/{slot}":read("Replay the latest bounded market response or latest incomplete response from cached inputs; operator only, no provider calls",{...responseSchema("MarketBatchDetail"),security:[{localOperator:[]}],parameters:[parameter("slot","path",{enum:["latest","latest_issue"]},true)]}),
    "/api/10x/admin/refresh": post("Run one bounded idempotent refresh; force skips pacing only, never pause, lease, quota or provider backoff", { force: { type: "boolean", default: false } }),
    "/api/10x/gmgn/solana/{address}": read("Cached normalized GMGN reports; no provider requests or organic-demand certification", { ...responseSchema("GmgnSummary"), parameters: [parameter("address", "path", { type: "string" }, true)] }),
    "/api/10x/admin/gmgn/status": read("Authenticated cached GMGN configuration, shared capacity and pilot status", { security: [{ localOperator: [] }] }),
    "/api/10x/admin/gmgn/reviews/{request_id}": read("Authenticated normalized saved GMGN review; no raw upstream redistribution", { security: [{ localOperator: [] }], parameters: [parameter("request_id", "path", { type: "string", format: "uuid" }, true)] }),
    "/api/10x/admin/gmgn/windows/{window_id}": read("Authenticated cached four-part candle coverage and price-unit corroboration; no provider requests", { security: [{ localOperator: [] }], parameters: [parameter("window_id", "path", { type: "string", format: "uuid" }, true)] }),
    "/api/10x/admin/gmgn/review": { post: { summary: "One bounded read-only GMGN attempt within existing shared admission; may hold without IO", security: [{ localOperator: [] }], requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(GmgnReviewRequestSchema) } } }, responses: { 200: ok, ...errors } } },
    "/api/10x/admin/market-refresh": post("Refresh up to 30 cached pool markets using one free source request"),
    "/api/10x/admin/wallet-replay": post("Reinterpret up to ten cached legacy wallet inputs with the certified v4 decoder; preserve observation timestamps and all gates, zero provider calls"),
    "/api/10x/admin/artwork-refresh": post("Cache up to three creation-linked metadata images per paced tick; 120 metadata requests/day inside the existing market cap, zero RPC calls"),
    "/api/10x/admin/quality-refresh": post("Refresh risk for up to ten current contenders and rotate holder inventories inside quality/global RPC caps; respects pacing and backoff"),
    "/api/10x/admin/wallet-refresh": post("Analyze one stored live token within the wallet and global free RPC budgets; respects pause, lease and provider backoff", { address: { type: "string", minLength: 32, maxLength: 44 } }),
    "/api/10x/admin/maintenance": post("Record local heartbeat, daily actual-time election rehearsal and review catch-up without provider calls"),
    "/api/10x/admin/review": post("Recompute prior daily outcome reports; proposals remain inactive"),
    "/api/10x/admin/pause": post("Pause or resume discovery; preserve evidence and balances", { paused: { type: "boolean" } }, ["paused"]),
    "/api/10x/admin/seed-fixtures": post("Seed synthetic examples in a separate fixture view"),
    "/api/10x/admin/dry-run": post("Freeze live inputs and simulate selection; retry with the same request_id to return the original snapshot and one audit", { request_id: { type: "string", format: "uuid" } }),
    "/api/10x/admin/policies/preview": { post: { ...post("Freeze and compare stricter numeric thresholds; locked evidence gates, no activation, zero provider calls, 20 new previews per UTC day").post, ...responseSchema("PolicyPreviewResponse"), requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/PolicyPreviewRequest" } } } } } },
    "/api/10x/admin/policies/previews/{id}": read("Load retained policy comparison and verify hashes/replay; authenticated, no-store", { ...responseSchema("PolicyPreviewResponse"), security: [{ localOperator: [] }], parameters: [parameter("id", "path", { type: "string", format: "uuid" }, true)] }),
    // These existing endpoint descriptions were previously edited only in the
    // generated output. Retain them on every schema regeneration.
    ...attentionPaths,
  },
  components: { securitySchemes: { localIdentity: {type:"apiKey", in:"cookie", name:"__Host-tenx_solana", description:"HttpOnly same-origin signed Solana identity session; loopback uses tenx_solana_local. Writes require exact Origin and X-Tenx-Identity: 1, not an operator token."}, localOperator: { type: "http", scheme: "bearer", description: "Random local operator token (32+ bytes); strict Bearer authorization, allowed local Origin and same-origin Fetch Metadata when supplied. Headerless local CLI/timer calls remain supported. Admin JSON bodies are limited to 32,000 bytes. Never stored in browser storage or source control." } }, schemas: {
    ContentCampaignList:z.toJSONSchema(ContentCampaignList), ContentCampaignDetail:z.toJSONSchema(ContentCampaignDetail), ContentCampaign:z.toJSONSchema(ContentCampaign), ContentCampaignRequest:z.toJSONSchema(ContentCampaignRequest), ContentSubmissionRequest:z.toJSONSchema(ContentSubmissionRequest), ContentAppealRequest:z.toJSONSchema(ContentAppealRequest), ContentReviewRequest:z.toJSONSchema(ContentReviewRequest), ContentPage:z.toJSONSchema(ContentPage), ContentRecord:z.toJSONSchema(ContentRecord), ContentChangeResponse:z.toJSONSchema(ContentChangeResponse),
    ContentReportPage:z.toJSONSchema(ContentReportPage),ContentReportRecord:z.toJSONSchema(ContentReportRecord),ContentReportRequest:z.toJSONSchema(ContentReportRequest),ContentReportReviewRequest:z.toJSONSchema(ContentReportReviewRequest),
    HoldReviewPage:z.toJSONSchema(HoldReviewPage),HoldReviewRecord:z.toJSONSchema(HoldReviewRecord),HoldReviewRequest:z.toJSONSchema(HoldReviewRequest),HoldReviewReply:z.toJSONSchema(HoldReviewReply),
    ContentOperations:z.toJSONSchema(ContentOperations),
    RewardList: z.toJSONSchema(RewardList,{unrepresentable:"any"}),
    RecoveryList:z.toJSONSchema(RecoveryList),RecoveryRequest:z.toJSONSchema(RecoveryRequest),
    RecoveryResponse:{type:"object",additionalProperties:false,required:["record","replay"],properties:{record:z.toJSONSchema(RecoveryRecord),replay:{const:"verified"}}},
    LaunchList: z.toJSONSchema(LaunchList,{unrepresentable:"any"}),
    LaunchRequest: z.toJSONSchema(LaunchRequest,{unrepresentable:"any"}),
    LaunchResponse: {type:"object",additionalProperties:false,required:["record","replay"],properties:{record:z.toJSONSchema(LaunchRecord,{unrepresentable:"any"}),replay:{const:"verified"}}},
    RewardRequest: z.toJSONSchema(RewardRequest,{unrepresentable:"any"}),
    RewardResponse: {type:"object",additionalProperties:false,required:["record","replay"],properties:{record:z.toJSONSchema(RewardRecord,{unrepresentable:"any"}),replay:{const:"verified"}}},
    OpenBackingRequest:z.toJSONSchema(OpenBackingRequest),
    BackingSummary:z.toJSONSchema(BackingSummary),
    BackingListResponse:z.toJSONSchema(BackingListResponse),
    BackingRecord:z.toJSONSchema(BackingRecord,{unrepresentable:"any"}),
    IdentityChallengeRequest: z.toJSONSchema(IdentityChallengeRequest),
    IdentityChallengeResponse: z.toJSONSchema(IdentityChallengeResponse),
    IdentityVerifyRequest: z.toJSONSchema(IdentityVerifyRequest),
    IdentitySessionResponse: z.toJSONSchema(IdentitySessionResponse),
    Candidate: z.toJSONSchema(AssessedCandidateSchema, { unrepresentable: "any" }),
    ArtworkResponse: z.toJSONSchema(ArtworkResponseSchema),
    ActivityObservation:z.toJSONSchema(ActivityObservation,{unrepresentable:"any"}),
    DiscoveryComparison:z.toJSONSchema(DiscoveryComparison,{unrepresentable:"any"}),
    GmgnSummary: z.toJSONSchema(GmgnPublicSummarySchema),
    GmgnRpcComparison:z.toJSONSchema(GmgnCorroborationReportSchema),
    GmgnQuoteReview:z.toJSONSchema(GmgnQuoteReportSchema),
    HolderHistoryReport: z.toJSONSchema(HolderHistoryReportSchema),
    HolderAcquisitionReport: z.toJSONSchema(HolderAcquisitionReportSchema),
    WalletWorkResponse: z.toJSONSchema(WalletWorkResponseSchema),
    WalletPlansResponse: z.toJSONSchema(WalletPlansResponseSchema),
    OperationsResponse: {type:"object",required:["data"],properties:{data:z.toJSONSchema(OperationsSchema)}},
    WatchdogReport: z.toJSONSchema(WatchdogReportSchema),
    Proof: z.toJSONSchema(ProofSchema, { unrepresentable: "any" }),
    DiscoveryPolicy: z.toJSONSchema(PolicySchema),
    PolicyEdits: z.toJSONSchema(PolicyEditsSchema),
    PolicyPreviewRequest: z.toJSONSchema(PreviewRequestSchema),
    PolicyPreviewResponse: z.toJSONSchema(PolicyPreviewResponseSchema, { unrepresentable: "any" }),
    SignalDetailResponse: z.toJSONSchema(SignalDetailSchema, { unrepresentable: "any" }),
    SignalsResponse: z.toJSONSchema(SignalsResponse, { unrepresentable: "any" }),
    ScoreResearchResponse:z.toJSONSchema(ScoreResearchResponse,{unrepresentable:"any"}),
    ScoreFollowupResponse:z.toJSONSchema(ScoreFollowupResponse,{unrepresentable:"any"}),
    ScoreResearchDetailResponse:z.toJSONSchema(ScoreResearchDetailSchema,{unrepresentable:"any"}),
    CandidateListResponse: z.toJSONSchema(ListResponse, { unrepresentable: "any" }),
    CandidateCardsResponse: z.toJSONSchema(CardListResponse, { unrepresentable: "any" }),
    CandidateDetailResponse: z.toJSONSchema(DetailResponse, { unrepresentable: "any" }),
    PoliciesResponse: z.toJSONSchema(PoliciesResponse, { unrepresentable: "any" }),
    SystemStatusResponse: z.toJSONSchema(StatusResponse, { unrepresentable: "any" }),
    MarketBatchDetail:z.toJSONSchema(MarketBatchDetailSchema,{unrepresentable:"any"}),
    DiscoveryScoreResponse:z.toJSONSchema(ScoreResponseSchema,{unrepresentable:"any"}),
    HistoryResponse: z.toJSONSchema(HistoryResponse, { unrepresentable: "any" }),
    ReviewsResponse: z.toJSONSchema(ReviewsResponse, { unrepresentable: "any" }),
    ElectionsResponse: z.toJSONSchema(ElectionsResponse, { unrepresentable: "any" }),
    ElectionDetailResponse: z.toJSONSchema(ElectionDetailResponse, { unrepresentable: "any" }),
    CoverageResponse: z.toJSONSchema(CoverageResponse, { unrepresentable: "any" }),
    InboxRecoveryResponse: z.toJSONSchema(InboxRecoveryResponse, { unrepresentable: "any" }),
    MintReviewsResponse: z.toJSONSchema(MintReviewsResponse, { unrepresentable: "any" }),
    MintReviewRequest: z.toJSONSchema(MintReviewRequest, { unrepresentable: "any" }),
    ActivityResponse: z.toJSONSchema(ActivityResponse, { unrepresentable: "any" }),
  } },
};
writeFileSync(new URL("../discovery/openapi.json", import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log("Generated discovery/openapi.json from runtime domain schemas.");
