import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GmgnEvidence, GmgnEvidenceValues } from "./GmgnEvidence";
import { type GmgnPublicSummary, GMGN_USE_AUTHORITY, GmgnPublicSummarySchema } from "../../../discovery/src/gmgn-model";
import {normalizeGmgnTraders} from "../../../discovery/src/gmgn-traders";
import {normalizeGmgnWalletActivity,normalizeGmgnWalletActivityResearch} from "../../../discovery/src/gmgn-wallet-activity";
const data: GmgnPublicSummary = { version: "gmgn-summary-v1", address: "So11111111111111111111111111111111111111112", use_authority: GMGN_USE_AUTHORITY,
  provider_rights_independently_confirmed: false, observations: 2, received_at: "2026-10-21T01:00:00.000Z", provider_observed_at: null, stale: true,
  reported_volume_24h_usd: 12345, reported_volume_1h_usd: null, reported_holder_count: 123, provider_wash_flag: false, provider_rug_ratio: 0,
  provider_insider_hold_ratio: .25, provider_bundler_volume_ratio: null, candle_count: null, candle_window_complete: null, candle_window_volume_usd: null,
  candle_review: null, candle_coverage: null, trader_sample:null,wallet_activity:null,wallet_activity_request_id:null,wallet_activity_issue:null, gaps: ["organic_volume_unknown"], organic_volume_usd: null, meaningful_holder_growth: null, scoring_effect: "none" };
describe("GMGN evidence presentation", () => {
  it("shows complete fifty-event research coverage with live collection held",()=>{
    const wallet_activity=normalizeGmgnWalletActivityResearch({activities:Array.from({length:50},(_,i)=>({tx_hash:"1".repeat(64),token:{address:data.address},event_type:"buy",timestamp:i+1,token_amount:10,cost_usd:2}))},{address:data.address,selection_id:"10000000-0000-4000-8000-000000000001",selection_hash:"a".repeat(64)},data.received_at!);
    const html=renderToStaticMarkup(<GmgnEvidenceValues data={{...data,wallet_activity,wallet_activity_request_id:"10000000-0000-4000-8000-000000000002"}}/>);
    expect(html).toContain("Requested 20 events; received 50");expect(html).toContain("50-event research cap; no rows discarded");expect(html).toContain("Live RPC collection remains held");
  });
  it("labels targeted activity, missing fields, pagination and reported patterns without wash or daily certification",()=>{
    const wallet_activity=normalizeGmgnWalletActivity({activities:[{tx_hash:"1".repeat(64),token:{address:data.address},event_type:"buy",timestamp:1,token_amount:10}],next:"opaque"},{address:data.address,selection_id:"10000000-0000-4000-8000-000000000001",selection_hash:"a".repeat(64)},data.received_at!);
    const html=renderToStaticMarkup(<GmgnEvidenceValues data={{...data,wallet_activity}}/>);
    for(const text of ["Selected wallet trading activity","targeted investigation","pagination held","not 24h totals","Unknown / Unknown","No wash-trading verdict","No listed pattern trigger"])expect(html).toContain(text);
    const{wallet_activity:_,...legacy}=data;expect(GmgnPublicSummarySchema.parse(legacy).wallet_activity).toBeNull();
    const failed=renderToStaticMarkup(<GmgnEvidenceValues data={{...data,observations:0,wallet_activity_issue:{received_at:data.received_at!,http_status:200,error:"source_collection_response_unusable",fields:["activities.cost_usd"]}}}/>);
    expect(failed).toContain("attempt held");expect(failed).toContain("No accepted activity sample");expect(failed).not.toContain("$0");
  });
  it("shows ranked flow denominators and period uncertainty without organic or wash certification",()=>{
    const trader_sample=normalizeGmgnTraders({list:[{address:data.address,addr_type:0,buy_volume_cur:100,sell_volume_cur:90}]},data.received_at!);
    const html=renderToStaticMarkup(<GmgnEvidenceValues data={{...data,trader_sample}}/>);
    for(const text of ["Ranked trader participation","not 24h totals","unknown population coverage","1 / 1","100.0%","$90","does not match actual counterparties","No organic-volume or scoring credit"])expect(html).toContain(text);
    const missing=renderToStaticMarkup(<GmgnEvidenceValues data={{...data,trader_sample:normalizeGmgnTraders({list:[{address:data.address,addr_type:0}]},data.received_at!)}}/>);
    expect(missing).toContain("Unknown / Unknown");expect(missing).not.toContain("$0");
    const{trader_sample:_,...legacy}=data;expect(GmgnPublicSummarySchema.parse(legacy).trader_sample).toBeNull();
  });
  it("separates complete coverage and price-correlated units from independent trade or organic-volume proof",()=>{
    const complete:GmgnPublicSummary={...data,candle_count:360,candle_window_complete:true,candle_window_volume_usd:4320,candle_coverage:{
      window_id:"10000000-0000-4000-8000-000000000001",expected_parts:4,attempted_parts:4,succeeded_parts:4,failed_parts:0,missing_minutes:0,overlap_conflicts:0,receipt_span_ms:33000,report_hash:"a".repeat(64),
      units:{version:"gmgn-unit-corroboration-v1",state:"price_consistent",usd_field:"volume",token_field:"amount",informative_candles:360,volume_usd_consistent:360,amount_usd_consistent:0,contradictory_flow_pairs:0,price_tolerance_pct:1,minimum_informative_candles:12,independent_trade_verification:false}
    }};
    const html=renderToStaticMarkup(<GmgnEvidenceValues data={complete}/>);
    for(const text of ["360 saved one-minute candles","requested window complete","4 / 4 window parts","0 missing minutes","volume = USD; amount = token units","arithmetic corroboration","not independent trade verification","not verified organic demand"])expect(html).toContain(text);
    const {candle_coverage:_coverage,...legacy}=data;expect(GmgnPublicSummarySchema.parse(legacy).candle_coverage).toBeNull();
    const partial=renderToStaticMarkup(<GmgnEvidenceValues data={{...complete,candle_count:328,candle_window_complete:false,candle_window_volume_usd:null}}/>);
    expect(partial).toContain("Full-window USD turnover withheld while coverage or flow totals are incomplete");
    expect(partial).not.toContain("candle volume units are unverified");
  });
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
