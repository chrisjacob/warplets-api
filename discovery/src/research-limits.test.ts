import { describe, expect, it } from "vitest";
import { researchLimits, researchMode } from "./research-limits";

describe("local calibration authority", () => {
  it("requires both explicit local-only operation and exact calibration mode; all other environments remain bounded", () => {
    for (const env of [{}, { TENX_RESEARCH_MODE: "local_calibration" }, { TENX_LOCAL_ONLY: "false", TENX_RESEARCH_MODE: "local_calibration" },
      { TENX_LOCAL_ONLY: "true" }, { TENX_LOCAL_ONLY: "true", TENX_RESEARCH_MODE: "unlimited" }, { TENX_LOCAL_ONLY: "true", TENX_RESEARCH_MODE: "bounded" }]) {
      expect(researchLimits(researchMode(env))).toEqual({ mode: "bounded", daily_records: 120, daily_bytes: 10_000_000, source_daily_requests: 20 });
    }
    expect(researchLimits(researchMode({ TENX_LOCAL_ONLY: "true", TENX_RESEARCH_MODE: "local_calibration" }))).toEqual({ mode: "local_calibration", daily_records: null, daily_bytes: null, source_daily_requests: null });
  });
});
