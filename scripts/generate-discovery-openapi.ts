import { writeFileSync } from "node:fs";
import { z } from "zod";
import { AssessedCandidateSchema, PolicySchema, ProofSchema } from "../discovery/src/model";
import { ArtworkResponseSchema } from "../discovery/src/artwork-model";
import { WalletWorkResponseSchema } from "../discovery/src/wallet-work-model";
import { WalletPlansResponseSchema } from "../discovery/src/wallet-plan-model";
import { PolicyEditsSchema, PolicyPreviewResponseSchema, PreviewRequestSchema } from "../discovery/src/policy-model";
import { SignalDetailSchema } from "../discovery/src/signal-model";
import { OperationsSchema, WatchdogReportSchema } from "../discovery/src/operations-model";
import { IdentityChallengeRequest, IdentityChallengeResponse, IdentitySessionResponse, IdentityVerifyRequest } from "../discovery/src/identity-model";
import { ActivityResponse, CoverageResponse, DetailResponse, ElectionDetailResponse, ElectionsResponse, HistoryResponse, ListResponse, PoliciesResponse, ReviewsResponse, SignalsResponse, StatusResponse } from "../app/src/discovery/client";

const ok = { description: "Success; cached public data includes timestamps, source freshness and coverage", content: { "application/json": { schema: { type: "object" } } } };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 429, 503].map(code => [code, { description: "Structured JSON error; no provider secrets" }]));
const read = (summary: string, extra: object = {}) => ({ get: { summary, responses: { 200: ok, ...errors }, ...extra } });
const responseSchema = (name: string) => ({ responses: { 200: { ...ok, content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } } }, ...errors } });
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
    "/api/10x/identity/session": read("Current local Solana identity and linked wallets; HttpOnly cookie, no provider calls; separate from Warplets/Farcaster", responseSchema("IdentitySessionResponse")),
    "/api/10x/identity/challenge": identityPost("Issue exact domain/address/chain/intent/browser-bound 5-minute challenge; 10 per browser/minute, 500 globally per UTC day", { $ref: "#/components/schemas/IdentityChallengeRequest" }, "IdentityChallengeResponse"),
    "/api/10x/identity/verify": identityPost("Verify exact stored message with strict Ed25519; atomic consumption, ownership, rotation and audit. Signed unlink revokes every identity session; last wallet is retained", { $ref: "#/components/schemas/IdentityVerifyRequest" }, "IdentitySessionResponse"),
    "/api/10x/identity/logout": identityPost("Revoke this browser session and its outstanding challenges; retain wallet links", { type: "object", additionalProperties: false, maxProperties: 0 }, "IdentitySessionResponse"),
    "/api/10x/health": read("Local service readiness"),
    "/api/10x/discovery/wallet-work": read("Cached resumable direct funding work; does not refresh wallet snapshots or waive eligibility gates", responseSchema("WalletWorkResponse")),
    "/api/10x/discovery/wallet-plan": read("Read-only funding plans for up to 20 current contenders and measured local collection yield; request estimates are lower bounds, zero provider calls and unchanged gates",responseSchema("WalletPlansResponse")),
    "/api/10x/artwork": read("Cached presentation artwork linked by saved verified Pump creation metadata; never changes eligibility or triggers provider calls", { ...responseSchema("ArtworkResponse"), parameters: [parameter("addresses", "query", { type: "string", description: "One to 100 comma-separated Solana mints" }, true)] }),
    "/api/10x/chains": read("Discovery capabilities, separate from launch support"),
    "/api/10x/candidates": read("At most 100 eligible/provisional/excluded candidates", { ...responseSchema("CandidateListResponse"), parameters: [parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 25 }), parameter("mode", "query", { enum: ["live", "fixture"], default: "live" }), parameter("status", "query", { enum: ["all", "eligible", "provisional", "excluded"] }), parameter("age", "query", { enum: ["all", "24h"], default: "all", description: "24h requires independently verified token creation time; the Discover view uses 24h" }), parameter("cursor", "query", { type: "string", maxLength: 300, description: "Opaque snapshot-bound cursor; 409 requires refresh" })] }),
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
    "/api/10x/research/signals/solana/{address}/{signal}": read("Frozen diagnostic input, verified feature replay and hash-checked outcome; no provider calls",{...responseSchema("SignalDetailResponse"),parameters:[parameter("address","path",{type:"string",minLength:32,maxLength:44},true),parameter("signal","path",{enum:["new_token_high_cap","smooth_price_rise"]},true)]}),
    "/api/10x/elections": read("Latest ten immutable local discovery rehearsals; no community voting or launch authority", responseSchema("ElectionsResponse")),
    "/api/10x/elections/{id}": read("Frozen candidate inventory/policy and verified deterministic replay; zero provider requests", { ...responseSchema("ElectionDetailResponse"), parameters: [parameter("id", "path", { type: "string", pattern: "^(daily-[0-9]{4}-[0-9]{2}-[0-9]{2}|manual-[0-9a-f-]{36})$" }, true)] }),
    "/api/10x/system/status": read("Freshness, declared coverage gaps, UTC provider budgets and pauses", responseSchema("SystemStatusResponse")),
    "/api/10x/system/operations": read("Read-only local heartbeat, due collectors, source/budget states and independently retained watchdog transitions; zero provider calls",responseSchema("OperationsResponse")),
    "/api/10x/admin/watchdog": {post:{...post("Retain a recent local supervisor observation; monotonic latest report and transition-only history, no provider calls").post,requestBody:{required:true,content:{"application/json":{schema:{type:"object",additionalProperties:false,required:["reason","report"],properties:{reason:{type:"string",minLength:3,maxLength:300},report:{$ref:"#/components/schemas/WatchdogReport"}}}}}}}},
    "/api/10x/transparency/policies": read("Actual local policy/hash, approval status, locked gates and separate review-only diagnostics", responseSchema("PoliciesResponse")),
    "/api/10x/admin/jobs": read("Restricted recent jobs and dry-run hashes", { security: [{ localOperator: [] }] }),
    "/api/10x/admin/refresh": post("Run one bounded idempotent refresh; force skips pacing only, never pause, lease, quota or provider backoff", { force: { type: "boolean", default: false } }),
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
  },
  components: { securitySchemes: { localOperator: { type: "http", scheme: "bearer", description: "Random local operator token; not stored in browser storage or source control" } }, schemas: {
    IdentityChallengeRequest: z.toJSONSchema(IdentityChallengeRequest),
    IdentityChallengeResponse: z.toJSONSchema(IdentityChallengeResponse),
    IdentityVerifyRequest: z.toJSONSchema(IdentityVerifyRequest),
    IdentitySessionResponse: z.toJSONSchema(IdentitySessionResponse),
    Candidate: z.toJSONSchema(AssessedCandidateSchema, { unrepresentable: "any" }),
    ArtworkResponse: z.toJSONSchema(ArtworkResponseSchema),
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
    CandidateListResponse: z.toJSONSchema(ListResponse, { unrepresentable: "any" }),
    CandidateDetailResponse: z.toJSONSchema(DetailResponse, { unrepresentable: "any" }),
    PoliciesResponse: z.toJSONSchema(PoliciesResponse, { unrepresentable: "any" }),
    SystemStatusResponse: z.toJSONSchema(StatusResponse, { unrepresentable: "any" }),
    HistoryResponse: z.toJSONSchema(HistoryResponse, { unrepresentable: "any" }),
    ReviewsResponse: z.toJSONSchema(ReviewsResponse, { unrepresentable: "any" }),
    ElectionsResponse: z.toJSONSchema(ElectionsResponse, { unrepresentable: "any" }),
    ElectionDetailResponse: z.toJSONSchema(ElectionDetailResponse, { unrepresentable: "any" }),
    CoverageResponse: z.toJSONSchema(CoverageResponse, { unrepresentable: "any" }),
    ActivityResponse: z.toJSONSchema(ActivityResponse, { unrepresentable: "any" }),
  } },
};
writeFileSync(new URL("../discovery/openapi.json", import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log("Generated discovery/openapi.json from runtime domain schemas.");
