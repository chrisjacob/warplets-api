import { z } from "zod";
import { PolicySchema } from "./model";
import { ElectionInputSchema, ElectionResultSchema } from "./election-model";
import {ScorePolicySchema} from "./discovery-score-model";

export const POLICY_FIELDS = [
  { key: "min_market_cap_usd", label: "Minimum reported market cap", unit: "USD", direction: "minimum" },
  { key: "min_liquidity_usd", label: "Minimum reported liquidity", unit: "USD", direction: "minimum" },
  { key: "min_holders", label: "Minimum non-vault owners", unit: "owners", direction: "minimum" },
  { key: "min_sampled_buyers", label: "Minimum sampled buyers", unit: "buyers", direction: "minimum" },
  { key: "max_top1_pct", label: "Largest owner / supply", unit: "%", direction: "maximum" },
  { key: "max_top10_pct", label: "Top ten owners / supply", unit: "%", direction: "maximum" },
  { key: "max_creator_pct", label: "Creation user / supply", unit: "%", direction: "maximum" },
  { key: "max_dev_funded_supply_pct", label: "Dev-funded buyer exposure", unit: "%", direction: "maximum" },
  { key: "max_dev_sold_supply_pct", label: "Sampled dev sales / supply", unit: "%", direction: "maximum" },
] as const;
export type PolicyField = typeof POLICY_FIELDS[number]["key"];
export const PolicyEditsSchema = PolicySchema.pick({ min_market_cap_usd: true, min_liquidity_usd: true, min_holders: true, min_sampled_buyers: true, max_top1_pct: true, max_top10_pct: true, max_creator_pct: true, max_dev_funded_supply_pct: true, max_dev_sold_supply_pct: true }).partial().strict();
export const PreviewRequestSchema = z.object({ request_id: z.uuid(), reason: z.string().trim().min(3).max(300), edits: PolicyEditsSchema }).strict();
export const PolicyPreviewInputSchema = z.object({ version: z.literal("policy-preview-v1"), baseline: ElectionInputSchema, proposed_policy: PolicySchema }).strict();
export const PolicyPreviewResultSchema = z.object({ baseline: ElectionResultSchema, proposed: ElectionResultSchema, changed: z.array(z.object({ address: z.string(), symbol: z.string(), before: z.enum(["eligible", "provisional", "excluded"]), after: z.enum(["eligible", "provisional", "excluded"]), added_reasons: z.array(z.string()), removed_reasons: z.array(z.string()) })).max(500), activated: z.literal(false), provider_requests: z.literal(0) }).strict();
export const PolicyPreviewRecordSchema = z.object({ id: z.uuid(), created_at: z.string().datetime(), reason: z.string().min(3).max(300), request_hash: z.string().length(64), input_hash: z.string().length(64), result_hash: z.string().length(64), record_hash: z.string().length(64), inputs: PolicyPreviewInputSchema, result: PolicyPreviewResultSchema }).strict();
export const PolicyPreviewResponseSchema = z.object({ record: PolicyPreviewRecordSchema, replay: z.literal("verified") }).strict();
export const PublicPolicySchema = z.object({ policy: PolicySchema, policy_hash: z.string().length(64), status: z.literal("proposed_local_policy"), approved_by: z.null(), activation_enabled: z.literal(false), display_score: z.string(),discovery_scoring:z.object({policy:ScorePolicySchema,policy_hash:z.string().length(64)}).strict().optional(), diagnostics: z.array(z.object({ name: z.string(), rule: z.string(), classification: z.literal("review_only") })), gaps: z.array(z.string()) }).strict();
