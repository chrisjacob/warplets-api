import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GmgnEvidence, GmgnEvidenceValues } from "./GmgnEvidence";
import { type GmgnPublicSummary, GMGN_USE_AUTHORITY, GmgnPublicSummarySchema } from "../../../discovery/src/gmgn-model";
const data: GmgnPublicSummary = { version: "gmgn-summary-v1", address: "So11111111111111111111111111111111111111112", use_authority: GMGN_USE_AUTHORITY,
  provider_rights_independently_confirmed: false, observations: 2, received_at: "2026-10-21T01:00:00.000Z", provider_observed_at: null, stale: true,
  reported_volume_24h_usd: 12345, reported_volume_1h_usd: null, reported_holder_count: 123, provider_wash_flag: false, provider_rug_ratio: 0,
  provider_insider_hold_ratio: .25, provider_bundler_volume_ratio: null, candle_count: null, candle_window_complete: null, candle_window_volume_usd: null,
  candle_review: null, gaps: ["organic_volume_unknown"], organic_volume_usd: null, meaningful_holder_growth: null, scoring_effect: "none" };
describe("GMGN evidence presentation", () => {
  it("shows candle coverage, unit uncertainty and descriptive pattern checks without a wash verdict", () => {
    const html = renderToStaticMarkup(<GmgnEvidenceValues data={{ ...data, candle_count: 20, candle_window_complete: false, candle_review: {
      received_at: data.received_at!, window_start: "2026-10-21T00:00:00.000Z", window_end: "2026-10-21T01:00:00.000Z",
      adjacent_pairs: 19, rising_adjacent_pairs: 19, longest_rising_run_pairs: 19, alternating_body_pairs: 18,
      adjacent_doubling_or_halving: 0, zero_reported_flow_moving_candles: 0, max_adjacent_close_move_pct: 1,
      review_reasons: ["twelve_or_more_consecutive_rising_closes"], wash_trading_verdict: "not_established", thresholds: "descriptive_review_v1_uncalibrated",
    } }} />);
    for (const text of ["20 saved one-minute candles", "requested window incomplete", "USD turnover unknown", "Trading pattern needs review", "19 consecutive", "18 adjacent", "Missing minutes break runs", "Candles alone do not establish wash trading", "do not change the Discovery score"]) expect(html).toContain(text);
    expect(html).not.toContain("$0 reported USD");
    const { candle_review: _review, ...legacy } = data;
    expect(GmgnPublicSummarySchema.parse(legacy).candle_review).toBeNull();
  });
  it("keeps raw activity, unknowns, stale receipts and false labels distinct from clean/organic evidence", () => {
    const html = renderToStaticMarkup(<GmgnEvidenceValues data={data} />);
    for (const text of ["$12,345", "Unknown", "Stale receipt", "Not flagged; coverage unknown", "25.0%", "not verified organic demand", "meaningful holder growth remains unknown", "do not change the Discovery score"]) expect(html).toContain(text);
    expect(html).not.toContain("0% safe");
  });
  it("shows provider flags without declaring proven fraud and missing observations without zero-demand claims", () => {
    expect(renderToStaticMarkup(<GmgnEvidenceValues data={{ ...data, provider_wash_flag: true }} />)).toContain("Flagged by provider");
    const html = renderToStaticMarkup(<GmgnEvidenceValues data={{ ...data, observations: 0 }} />);
    expect(html).toContain("No saved GMGN observations"); expect(html).not.toContain("$0");
  });
  it("starts collapsed without a fetch/render-driven collection control", () => {
    const html = renderToStaticMarkup(<GmgnEvidence address={data.address} />);
    expect(html).toContain("GMGN activity &amp; risk evidence"); expect(html).not.toContain("<button"); expect(html).not.toContain("open=");
  });
});
