import { z } from "zod";
import { validAddress } from "./solana";

export const Address = z.string().max(44).refine(validAddress, "Invalid Solana address");
export const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
export const ProofSchema = z.object({
  kind: z.enum(["creation", "graduation"]), signature: Signature,
  slot: z.number().int().nonnegative().safe(), block_time: z.string().datetime(),
  instruction: z.string(), instruction_index: z.string(), program: Address,
  payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
  fetched_at: z.string().datetime(), source: z.literal("solana-finalized-rpc"),
  adapter_version: z.string(),
}).strict();
export type Proof = z.infer<typeof ProofSchema>;
export const MarketSchema = z.object({
  source: z.literal("geckoterminal"), fetched_at: z.string().datetime(),
  observed_at: z.string().datetime().nullable(),
  price_usd: z.number().finite().nonnegative().nullable(),
  market_cap_usd: z.number().finite().nonnegative().nullable(),
  fdv_usd: z.number().finite().nonnegative().nullable(),
  liquidity_usd: z.number().finite().nonnegative().nullable(),
  volume_24h_usd: z.number().finite().nonnegative().nullable(),
}).strict();
export type Market = z.infer<typeof MarketSchema>;
export const CandidateSchema = z.object({
  chain: z.literal("solana"), address: Address, pool: Address,
  name: z.string().max(100), symbol: z.string().max(32),
  creation: ProofSchema.nullable(), graduation: ProofSchema.nullable(),
  verification: z.enum(["verified", "provisional", "rejected"]),
  verification_reasons: z.array(z.string()).max(32),
  risk: z.object({
    mint_authority: z.enum(["revoked", "active", "unknown"]),
    freeze_authority: z.enum(["revoked", "active", "unknown"]),
    token_program: z.string(), mint_extensions: z.array(z.number().int()),
    holder_concentration: z.literal("unknown"),
    pool_reserves_verified: z.boolean(), observed_at: z.string().datetime().nullable(),
    context_slot: z.number().int().safe().nonnegative().nullable().default(null),
    payload_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  }).strict(),
  market: MarketSchema.nullable(), first_seen_at: z.string().datetime(), checked_at: z.string().datetime(),
  mode: z.enum(["live", "fixture"]),
}).strict();
export type Candidate = z.infer<typeof CandidateSchema>;
export const PolicySchema = z.object({
  version: z.literal("discovery-local-v1"), max_candidates: z.number().int().min(1).max(100),
  max_age_hours: z.literal(24), min_market_cap_usd: z.number().finite().nonnegative(),
  min_liquidity_usd: z.number().finite().nonnegative(), max_market_age_seconds: z.number().int().positive(),
  max_risk_age_seconds: z.number().int().positive(), require_holder_evidence: z.boolean(),
}).strict();
export type Policy = z.infer<typeof PolicySchema>;
export const DEFAULT_POLICY: Policy = {
  version: "discovery-local-v1", max_candidates: 100, max_age_hours: 24,
  min_market_cap_usd: 100_000, min_liquidity_usd: 25_000,
  max_market_age_seconds: 180, max_risk_age_seconds: 600,
  require_holder_evidence: true,
};
export const AssessedCandidateSchema = CandidateSchema.extend({
  eligibility: z.enum(["eligible", "provisional", "excluded"]),
  reasons: z.array(z.string()), rank: z.number().int().positive().nullable(), launch_eligible: z.literal(false),
});
export type AssessedCandidate = z.infer<typeof AssessedCandidateSchema>;
export function assess(candidate: Candidate, policy: Policy, now: Date): AssessedCandidate {
  const exclude: string[] = [], unknown: string[] = [...candidate.verification_reasons];
  if (candidate.verification === "rejected") exclude.push("proof_rejected");
  if (!candidate.creation) unknown.push("creation_unverified");
  else {
    const age = now.getTime() - Date.parse(candidate.creation.block_time);
    if (age < 0) exclude.push("creation_in_future");
    if (age > policy.max_age_hours * 3600_000) exclude.push("token_older_than_24h");
  }
  if (!candidate.graduation) unknown.push("graduation_unverified");
  if (candidate.creation && candidate.graduation && Date.parse(candidate.creation.block_time) > Date.parse(candidate.graduation.block_time)) exclude.push("graduation_before_creation");
  if (candidate.verification !== "verified") unknown.push("chain_verification_incomplete");
  for (const kind of ["mint_authority", "freeze_authority"] as const) {
    if (candidate.risk[kind] === "active") exclude.push(`${kind}_active`);
    if (candidate.risk[kind] === "unknown") unknown.push(`${kind}_unknown`);
  }
  if (!candidate.risk.pool_reserves_verified) unknown.push("pool_reserves_unverified");
  if (!candidate.risk.observed_at || now.getTime() - Date.parse(candidate.risk.observed_at) > policy.max_risk_age_seconds * 1000) unknown.push("risk_evidence_stale");
  if (policy.require_holder_evidence) unknown.push("holder_concentration_unknown");
  const market = candidate.market;
  if (!market) unknown.push("market_data_unavailable");
  else {
    if (now.getTime() - Date.parse(market.fetched_at) > policy.max_market_age_seconds * 1000) unknown.push("market_data_stale");
    if (market.market_cap_usd === null) unknown.push("market_cap_unknown_not_fdv");
    else if (market.market_cap_usd < policy.min_market_cap_usd) exclude.push("market_cap_below_threshold");
    if (market.liquidity_usd === null) unknown.push("liquidity_unknown");
    else if (market.liquidity_usd < policy.min_liquidity_usd) exclude.push("liquidity_below_threshold");
  }
  return { ...candidate, eligibility: exclude.length ? "excluded" : unknown.length ? "provisional" : "eligible", reasons: [...new Set([...exclude, ...unknown])], rank: null, launch_eligible: false };
}
export function shortlist(candidates: Candidate[], policy: Policy, now: Date): AssessedCandidate[] {
  const unique = new Map<string, Candidate>();
  for (const c of candidates) {
    const current = unique.get(c.address);
    if (!current || c.checked_at > current.checked_at) unique.set(c.address, c);
  }
  const rows = [...unique.values()].map(c => assess(c, policy, now));
  // Local display rule only: verified liquidity, then creation, then address.
  const eligible = rows.filter(c => c.eligibility === "eligible").sort((a, b) =>
    (b.market?.liquidity_usd ?? 0) - (a.market?.liquidity_usd ?? 0) ||
    (a.creation?.block_time ?? "").localeCompare(b.creation?.block_time ?? "") || a.address.localeCompare(b.address));
  const ranked = eligible.slice(0, policy.max_candidates).map((c, i) => ({ ...c, rank: i + 1 }));
  const rest = rows.filter(c => c.eligibility !== "eligible").sort((a, b) => b.checked_at.localeCompare(a.checked_at) || a.address.localeCompare(b.address));
  return [...ranked, ...rest].slice(0, policy.max_candidates);
}
