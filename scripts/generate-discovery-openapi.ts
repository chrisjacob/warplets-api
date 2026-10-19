import { writeFileSync } from "node:fs";
import { z } from "zod";
import { AssessedCandidateSchema, PolicySchema, ProofSchema } from "../discovery/src/model";
import { DetailResponse, HistoryResponse, ListResponse, ReviewsResponse, StatusResponse } from "../app/src/discovery/client";

const ok = { description: "Success; cached public data includes timestamps, source freshness and coverage", content: { "application/json": { schema: { type: "object" } } } };
const errors = Object.fromEntries([400, 401, 403, 404, 409, 413, 415, 503].map(code => [code, { description: "Structured JSON error; no provider secrets" }]));
const read = (summary: string, extra: object = {}) => ({ get: { summary, responses: { 200: ok, ...errors }, ...extra } });
const responseSchema = (name: string) => ({ responses: { 200: { ...ok, content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } } }, ...errors } });
const reason = { type: "string", minLength: 3, maxLength: 300 };
const post = (summary: string, properties: object = {}, required: string[] = []) => ({ post: { summary, security: [{ localOperator: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { reason, ...properties }, required: ["reason", ...required] } } } }, responses: { 200: ok, ...errors } } });
const parameter = (name: string, where: "query" | "path", schema: object, required = false) => ({ name, in: where, required, schema });
const spec = {
  openapi: "3.1.0", info: { title: "10X local Solana discovery", version: "0.1.0", description: "Local-only, read-only chain discovery. No signing, votes, launches or financial flows. Public reads use stored data; only authenticated refresh makes provider requests." },
  servers: [{ url: "http://127.0.0.1:8794" }],
  paths: {
    "/api/10x/health": read("Local service readiness"),
    "/api/10x/chains": read("Discovery capabilities, separate from launch support"),
    "/api/10x/candidates": read("At most 100 eligible/provisional/excluded candidates", { ...responseSchema("CandidateListResponse"), parameters: [parameter("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 25 }), parameter("mode", "query", { enum: ["live", "fixture"], default: "live" }), parameter("status", "query", { enum: ["all", "eligible", "provisional", "excluded"] }), parameter("cursor", "query", { type: "string", maxLength: 300, description: "Opaque snapshot-bound cursor; 409 requires refresh" })] }),
    "/api/10x/candidates/solana/{address}": read("Candidate identity, separate origin/migration proofs and risk", { ...responseSchema("CandidateDetailResponse"), parameters: [parameter("address", "path", { type: "string", minLength: 32, maxLength: 44 }, true), parameter("mode", "query", { enum: ["live", "fixture"] })] }),
    "/api/10x/evidence/{signature}": read("Saved normalized RPC transaction and SHA-256 evidence hash", { parameters: [parameter("signature", "path", { type: "string", minLength: 64, maxLength: 88 }, true)] }),
    "/api/10x/account-evidence/{hash}": read("Saved finalized mint, pool, vault and curve account snapshot", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/holder-evidence/{hash}": read("Replayable finalized owner inventory and reconciled mint supply", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/wallet-evidence/{hash}": read("Replayable finalized transaction sample, funding links, holder inputs and local outcome associations", { parameters: [parameter("hash", "path", { type: "string", pattern: "^[a-f0-9]{64}$" }, true)] }),
    "/api/10x/wallets/solana/{address}": read("Cached wallet profiles across at most 20 locally analyzed tokens; incomplete lifetime coverage", { parameters: [parameter("address", "path", { type: "string", minLength: 32, maxLength: 44 }, true)] }),
    "/api/10x/history/solana/{address}": read("Saved local price and nullable market cap observations; no invented backfill", { ...responseSchema("HistoryResponse"), parameters: [parameter("address", "path", { type: "string" }, true), parameter("hours", "query", { type: "integer", minimum: 1, maximum: 168, default: 24 })] }),
    "/api/10x/research/reviews": read("Daily outcome reports, chronological holdout proposals and evidence-based wallet associations", responseSchema("ReviewsResponse")),
    "/api/10x/system/status": read("Freshness, declared coverage gaps, UTC provider budgets and pauses", responseSchema("SystemStatusResponse")),
    "/api/10x/transparency/policies": read("Proposed local discovery policy and deterministic display ordering"),
    "/api/10x/admin/jobs": read("Restricted recent jobs and dry-run hashes", { security: [{ localOperator: [] }] }),
    "/api/10x/admin/refresh": post("Run one bounded idempotent refresh; force skips pacing only, never pause, lease, quota or provider backoff", { force: { type: "boolean", default: false } }),
    "/api/10x/admin/market-refresh": post("Refresh up to 30 cached pool markets using one free source request"),
    "/api/10x/admin/wallet-refresh": post("Analyze one stored live token within the wallet and global free RPC budgets; respects pause, lease and provider backoff", { address: { type: "string", minLength: 32, maxLength: 44 } }),
    "/api/10x/admin/maintenance": post("Record local heartbeat and catch up daily reviews without provider calls"),
    "/api/10x/admin/review": post("Recompute prior daily outcome reports; proposals remain inactive"),
    "/api/10x/admin/pause": post("Pause or resume discovery; preserve evidence and balances", { paused: { type: "boolean" } }, ["paused"]),
    "/api/10x/admin/seed-fixtures": post("Seed synthetic examples in a separate fixture view"),
    "/api/10x/admin/dry-run": post("Freeze live inputs and simulate selection; never launch"),
    "/api/10x/admin/policies/preview": post("Preview a policy without activating it", { policy: { $ref: "#/components/schemas/DiscoveryPolicy" } }, ["policy"]),
  },
  components: { securitySchemes: { localOperator: { type: "http", scheme: "bearer", description: "Random local operator token; not stored in browser storage or source control" } }, schemas: {
    Candidate: z.toJSONSchema(AssessedCandidateSchema, { unrepresentable: "any" }),
    Proof: z.toJSONSchema(ProofSchema, { unrepresentable: "any" }),
    DiscoveryPolicy: z.toJSONSchema(PolicySchema),
    CandidateListResponse: z.toJSONSchema(ListResponse, { unrepresentable: "any" }),
    CandidateDetailResponse: z.toJSONSchema(DetailResponse, { unrepresentable: "any" }),
    SystemStatusResponse: z.toJSONSchema(StatusResponse, { unrepresentable: "any" }),
    HistoryResponse: z.toJSONSchema(HistoryResponse, { unrepresentable: "any" }),
    ReviewsResponse: z.toJSONSchema(ReviewsResponse, { unrepresentable: "any" }),
  } },
};
writeFileSync(new URL("../discovery/openapi.json", import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log("Generated discovery/openapi.json from runtime domain schemas.");
