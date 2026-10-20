import { z } from "zod";
import { Address, CandidateSchema, PolicySchema } from "./model";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ElectionId = z.string().regex(/^(?:daily-\d{4}-\d{2}-\d{2}|manual-[0-9a-f-]{36})$/);
export const ElectionInputSchema = z.object({
  version: z.literal("election-input-v1"), rules_version: z.literal("discovery-election-v1"),
  as_of: z.string().datetime(), policy: PolicySchema, candidates: z.array(CandidateSchema).max(500),
}).strict();
export const ElectionResultSchema = z.object({
  version: z.literal("election-result-v1"), as_of: z.string().datetime(),
  outcome: z.enum(["simulated_winner", "no_eligible_winner"]), winner_address: Address.nullable(),
  ranking_rule: z.literal("eligible liquidity descending, creation ascending, address ASCII ascending"),
  counts: z.object({ observed: z.number().int().nonnegative(), eligible: z.number().int().nonnegative(), provisional: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), shortlisted: z.number().int().nonnegative().max(100) }).strict(),
  candidates: z.array(z.object({
    address: Address, symbol: z.string(), name: z.string(), eligibility: z.enum(["eligible", "provisional", "excluded"]),
    reasons: z.array(z.string()), rank: z.number().int().positive().nullable(),
    created_at: z.string().datetime().nullable(), market_cap_usd: z.number().nullable(), liquidity_usd: z.number().nullable(),
  }).strict()).max(500),
  voting_enabled: z.literal(false), launch_enabled: z.literal(false), gaps: z.array(z.string()).max(20),
}).strict();
export const ElectionSummarySchema = z.object({
  id: ElectionId, kind: z.enum(["manual", "daily"]), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: z.string().datetime(), input_hash: Hash, result_hash: Hash, record_hash: Hash,
  result: ElectionResultSchema,
}).strict();
export const ElectionRecordSchema = ElectionSummarySchema.extend({ inputs: ElectionInputSchema }).strict();
export const ElectionReplaySchema = z.object({ status: z.literal("verified"), input_hash_matches: z.literal(true), result_hash_matches: z.literal(true), result_matches: z.literal(true), provider_requests: z.literal(0) }).strict();
export type ElectionInput = z.infer<typeof ElectionInputSchema>;
export type ElectionResult = z.infer<typeof ElectionResultSchema>;
export type ElectionSummary = z.infer<typeof ElectionSummarySchema>;
export type ElectionRecord = z.infer<typeof ElectionRecordSchema>;
export type ElectionReplay = z.infer<typeof ElectionReplaySchema>;
