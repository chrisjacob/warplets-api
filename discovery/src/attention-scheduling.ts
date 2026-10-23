import { z } from "zod";
import { AttentionRequest, type AttentionChainId } from "./attention-feed-contract";
import type { AttentionQueueResult } from "./attention-queue-model";

export const ATTENTION_FOLLOWUP_POLICY = {
  version: "attention-fair-followup-v1", returned_rows_max: 100, crosscheck_addresses_max: 20,
  history_hours: 24, history_attempts_max: 25, request_bytes_max: 5000,
  chain_order: "least_recent_attempt_then_original_queue_position",
  token_order: "least_recent_attempt_then_original_queue_position",
  failed_attempts_count: true, token_age_max: null, scoring_effect: "none",
} as const;
// Keep v1 and its selector unchanged for replay of original saved allocations.
// This allocation changes only which eligible chain receives the existing hour.
export const ATTENTION_ALLOCATION_POLICY = {
  ...ATTENTION_FOLLOWUP_POLICY,
  version: "attention-solana-allocation-v2",
  chain_order: "even_utc_hour_solana_odd_utc_hour_other_chains_then_v1_fairness",
  empty_preferred_group: "use_other_eligible_group",
  crosscheck_batches_per_hour_max: 1,
  freshness_seconds: 7200,
} as const;
const SavedAttempt = z.object({ request: z.string().max(5000), last_attempt: z.string().datetime() }).strict();
export type AttentionReviewAttempt = { chain: AttentionChainId; addresses: string[]; last_attempt: string };
export function decodeAttentionReviewAttempts(raw: unknown): AttentionReviewAttempt[] {
  return z.array(SavedAttempt).max(25).parse(raw).map(row => {
    const request = AttentionRequest.parse(JSON.parse(row.request));
    if (request.kind !== "attention_dex_crosscheck") throw Error("attention_review_attempt_kind");
    return { chain: request.chain, addresses: request.addresses, last_attempt: row.last_attempt };
  });
}
export async function readAttentionReviewAttempts(db: D1Database, now: Date) {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const rows = await db.prepare(`SELECT CASE WHEN length(CAST(request AS BLOB))<=5000 THEN request ELSE NULL END AS request,reserved_at AS last_attempt
    FROM tenx_source_reservations WHERE day>=?1 AND reserved_at>=?2 AND reserved_at<=?3
    AND id GLOB 'attention-review-*' AND json_extract(request,'$.kind')='attention_dex_crosscheck'
    ORDER BY reserved_at DESC,id DESC LIMIT 25`).bind(since.slice(0, 10), since, now.toISOString()).all();
  return decodeAttentionReviewAttempts(rows.results);
}
export function fairAttentionReviewRequest(queue: AttentionQueueResult, attempts: AttentionReviewAttempt[] = []) {
  if (queue.rows.length > 100 || attempts.length > 25) throw Error("attention_followup_selection_bound");
  const at = Date.parse(queue.as_of), byChain = new Map<string, string>(), byToken = new Map<string, string>();
  for (const attempt of attempts) {
    // Reuse the exact contract validator, including chain-specific identities.
    const request = AttentionRequest.parse({ kind: "attention_dex_crosscheck", chain: attempt.chain, addresses: attempt.addresses });
    if (request.kind !== "attention_dex_crosscheck") throw Error("attention_review_attempt_kind");
    const time = Date.parse(z.string().datetime().parse(attempt.last_attempt));
    if (time > at) throw Error("attention_review_attempt_future");
    if (time < at - 86_400_000) continue;
    const latest = new Date(time).toISOString();
    if (latest > (byChain.get(request.chain) ?? "")) byChain.set(request.chain, latest);
    for (const address of request.addresses) {
      const key = `${request.chain}:${address.toLowerCase()}`;
      // Solana identities remain case-sensitive; EVM normalization is provided
      // by the request validator's canonical comparison below.
      const identity = request.chain === "solana" ? `${request.chain}:${address}` : key;
      if (latest > (byToken.get(identity) ?? "")) byToken.set(identity, latest);
    }
  }
  const pending = queue.rows.filter(row => row.checks !== "adverse" && row.attention_families > 0 && !row.market_crosschecked);
  const chains = [...new Set(pending.map(row => row.chain))].sort((a, b) => (byChain.get(a) ?? "").localeCompare(byChain.get(b) ?? ""));
  const chain = chains[0]; if (!chain) return null;
  const identity = (address: string) => `${chain}:${chain === "solana" ? address : address.toLowerCase()}`;
  const addresses = pending.filter(row => row.chain === chain)
    .sort((a, b) => (byToken.get(identity(a.address)) ?? "").localeCompare(byToken.get(identity(b.address)) ?? ""))
    .slice(0, 20).map(row => row.address);
  return AttentionRequest.parse({ kind: "attention_dex_crosscheck", chain, addresses });
}

export function allocatedAttentionReviewRequest(queue: AttentionQueueResult, attempts: AttentionReviewAttempt[] = []) {
  if (queue.rows.length > 100 || attempts.length > 25) throw Error("attention_followup_selection_bound");
  const hour = new Date(z.string().datetime().parse(queue.as_of)).getUTCHours();
  const preferSolana = hour % 2 === 0;
  const preferred = queue.rows.filter(row => (row.chain === "solana") === preferSolana);
  // v1 still validates exact attempt identities/times and orders chains/tokens.
  // A failed preferred request stays spent; fallback is only for absent work,
  // never a replacement after dispatch or an extra request in the same hour.
  return fairAttentionReviewRequest({ ...queue, rows: preferred }, attempts)
    ?? fairAttentionReviewRequest(queue, attempts);
}
