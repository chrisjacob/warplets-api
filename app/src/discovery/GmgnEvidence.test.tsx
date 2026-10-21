import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GmgnEvidence, GmgnEvidenceValues } from "./GmgnEvidence";
import { type GmgnPublicSummary, GMGN_USE_AUTHORITY } from "../../../discovery/src/gmgn-model";
const data: GmgnPublicSummary = { version: "gmgn-summary-v1", address: "So11111111111111111111111111111111111111112", use_authority: GMGN_USE_AUTHORITY,
  provider_rights_independently_confirmed: false, observations: 2, received_at: "2026-10-21T01:00:00.000Z", provider_observed_at: null, stale: true,
  reported_volume_24h_usd: 12345, reported_volume_1h_usd: null, reported_holder_count: 123, provider_wash_flag: false, provider_rug_ratio: 0,
  provider_insider_hold_ratio: .25, provider_bundler_volume_ratio: null, candle_count: null, candle_window_complete: null, candle_window_volume_usd: null,
  gaps: ["organic_volume_unknown"], organic_volume_usd: null, meaningful_holder_growth: null, scoring_effect: "none" };
describe("GMGN evidence presentation", () => {
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
