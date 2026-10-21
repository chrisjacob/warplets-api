import { SCORE_RESEARCH_LIMITS } from "./score-research-model";

export type ResearchMode = "bounded" | "local_calibration";
export function researchMode(env: { TENX_LOCAL_ONLY?: string; TENX_RESEARCH_MODE?: string }): ResearchMode {
  return env.TENX_LOCAL_ONLY === "true" && env.TENX_RESEARCH_MODE === "local_calibration" ? "local_calibration" : "bounded";
}
// Null is an explicit disabled local admission cap, never an infinite SQL number.
// Provider budgets, per-record bounds, leases, pacing and evidence stay separate.
export function researchLimits(mode: ResearchMode = "bounded") {
  return { mode, daily_records: mode === "local_calibration" ? null : SCORE_RESEARCH_LIMITS.daily_records,
    daily_bytes: mode === "local_calibration" ? null : SCORE_RESEARCH_LIMITS.daily_bytes,
    source_daily_requests: mode === "local_calibration" ? null : 20 };
}
