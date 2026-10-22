import { AttentionQueue, type AttentionQueueResult } from "../../../discovery/src/attention-queue-model";
import { AttentionReviewContext, captureAttentionReview, REVIEW_BYTE_LIMIT, type ReviewContext } from "./attention-review-store";
import { DISCOVERY_RESPONSE_LIMITS } from "./bounded-json";

// Compare only explicitly loaded, bounded observations. No IO or saved-history
// mutation; a later list cutoff is not proof of a newer underlying observation.
export function compareAttentionReview(saved: ReviewContext, loaded: AttentionQueueResult, now = new Date()) {
  if (new TextEncoder().encode(JSON.stringify(saved)).length > REVIEW_BYTE_LIMIT ||
      new TextEncoder().encode(JSON.stringify(loaded)).length > DISCOVERY_RESPONSE_LIMITS.bytes) throw Error("review_comparison_bound");
  const original = AttentionReviewContext.parse(saved), report = AttentionQueue.parse(loaded), at = now.getTime();
  if (!Number.isFinite(at) || Date.parse(original.as_of) > at || Date.parse(report.as_of) > at) throw Error("review_comparison_clock");
  const matches = report.rows.filter(row => row.chain === original.token.chain && row.address === original.token.address);
  if (!matches.length) return { state: "absent" as const, as_of: report.as_of, truncated: report.history_truncated };
  if (matches.length !== 1) throw Error("review_comparison_identity");
  if (Date.parse(report.as_of) <= Date.parse(original.as_of)) return { state: "not_newer" as const, as_of: report.as_of };
  const current = captureAttentionReview(report, original.token.address, original.token.chain);
  if (new TextEncoder().encode(JSON.stringify(current)).length > REVIEW_BYTE_LIMIT) throw Error("review_comparison_bound");
  return { state: "ready" as const, original: structuredClone(original), current, provider_requests: 0 as const,
    scoring_effect: "none" as const, evidence_gates_changed: false as const };
}
export type AttentionReviewComparison = ReturnType<typeof compareAttentionReview>;
