import { z } from "zod";
import { AssessedCandidateSchema, ProofSchema, type AssessedCandidate } from "./model";
import { HolderSchema } from "./holder-model";

// Presentation only. Assess the complete candidate first, then project its card.
// Missing evidence is never replaced with empty arrays or used to reassess a pass.
export const CandidateCardSchema = AssessedCandidateSchema.pick({ chain: true, address: true, name: true, symbol: true, mode: true, verification: true, market: true, eligibility: true, reasons: true }).extend({
  creation: ProofSchema.pick({ block_time: true }).nullable(),
  holders: HolderSchema.pick({ status: true, holder_count: true, top1_pct: true }).nullable(),
}).strict();
export type CandidateCard = z.infer<typeof CandidateCardSchema>;
export function candidateCard(c: AssessedCandidate): CandidateCard {
  return CandidateCardSchema.parse({ chain: c.chain, address: c.address, name: c.name, symbol: c.symbol, mode: c.mode, verification: c.verification, market: c.market, eligibility: c.eligibility, reasons: c.reasons,
    creation: c.creation ? { block_time: c.creation.block_time } : null,
    holders: c.holders ? { status: c.holders.status, holder_count: c.holders.holder_count, top1_pct: c.holders.top1_pct } : null });
}
