import { AMM, TOKEN, TOKEN_2022 } from "./pump";
import { findPda, publicKey, seed } from "./solana";

// Lookup hints only. Actual successful Pump instructions must still prove each
// event and match every original canonical state identity field.
export const TARGETED_HISTORY_POLICY = {
  version: "attention-historical-targeting-v2",
  cohort: "new_canonical_intake_v2_only_no_existing_mint_reset",
  migration_target: "canonical_pool_lp_mint_pda",
  classic_creation_target: "metaplex_metadata_pda",
  token2022_creation_target: "mint_no_separate_metadata_assumed",
  target_order: "lp_then_missing_creation_target_with_original_same_target_cursors",
  pages_per_mint: 3, signatures_per_page: 1000, bodies_per_page: 4,
  rpc_calls_per_turn: 6, turns_per_utc_hour: 3,
  body_order: "first_two_then_last_two_uninspected_finalized_successes_at_or_before_state_slot",
  target_membership_required: true, missing_is_unknown: true,
  candidate_admitted: false, scoring_effect: "none",
} as const;
export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export type HistoryTargetKind = "pool_lp_mint" | "classic_metadata" | "token2022_mint";
export async function attentionHistoryTargets(identity: { address: string; pool: string; baseProgram: string }) {
  if (identity.baseProgram !== TOKEN && identity.baseProgram !== TOKEN_2022) throw Error("history_target_token_program");
  return {
    migration: { kind: "pool_lp_mint" as const, address: await findPda(AMM, [seed("pool_lp_mint"), publicKey(identity.pool)]) },
    creation: identity.baseProgram === TOKEN
      ? { kind: "classic_metadata" as const, address: await findPda(METADATA_PROGRAM, [seed("metadata"), publicKey(METADATA_PROGRAM), publicKey(identity.address)]) }
      : { kind: "token2022_mint" as const, address: identity.address },
  };
}
