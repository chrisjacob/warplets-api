import{describe,expect,it}from"vitest";
import{renderToStaticMarkup}from"react-dom/server";
import{GmgnQuote,GmgnQuoteValues,quoteSol}from"./GmgnQuote";
import{type GmgnQuoteReport}from"../../../discovery/src/gmgn-quote-model";
const report:GmgnQuoteReport={version:"gmgn-quote-review-v1",activity_id:"10000000-0000-4000-8000-000000000001",address:"So11111111111111111111111111111111111111112",cutoff_at:"2026-10-21T09:00:00.000Z",comparison_hash:"a".repeat(64),status:"reviewed_sample",reported_trade_events:2,supported_events:2,quote_decimals:9,buy_pool_quote_transfer_raw:"989454343577",sell_pool_quote_transfer_raw:null,groups:[{side:"buy",events:2,token_match:"exact_instruction_quantities",quote_kinds:["wsol_raw"],pool_quote_transfer_raw:"989454343577",reported_usd:105119.62946162048,implied_usd_per_sol:106.24,fee_rows:2,fee_status:"partial",event_quote_raw:"987481158721",known_fee_raw:"11850267646",wallet_swap_cashflow_raw:null,gaps:["fee_event_extension_uninterpreted","wallet_swap_cashflow_withheld"]}],gaps:["organic_volume_and_scoring_held"],historical_usd_verified:false,organic_volume_usd:null,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0,report_hash:"b".repeat(64)};
describe("saved quote transfer review",()=>{
 it("formats exact large raw units and separates explicit zero from missing",()=>{
  expect(quoteSol("989454343577")).toBe("989.454343577 SOL");expect(quoteSol("123456789012345678901")).toBe("123456789012.345678901 SOL");expect(quoteSol("0")).toBe("0 SOL");expect(quoteSol(null)).toBe("Unknown");
 });
 it("distinguishes pool/event/fee bases, unknown extensions and implied currency conversion",()=>{
  const html=renderToStaticMarkup(<GmgnQuoteValues data={report}/>);for(const text of["989.454343577 SOL","987.481158721 SOL","11.850267646 SOL","Wallet swap cash flow","Unknown","partial","106.24","not an independently verified historical SOL price","not organic or 24h volume","No USD verification, wash verdict, scoring or action credit"])expect(html).toContain(text);expect(html).not.toContain("<button");
 });
 it("preserves held and empty-side states without showing measured zero SOL",()=>{
  const html=renderToStaticMarkup(<GmgnQuoteValues data={{...report,status:"held",supported_events:0,buy_pool_quote_transfer_raw:null,groups:[]}}/>);expect(html).toContain("Review held by its bounds");expect(html).toContain("Buy-side pool transfers: Unknown");expect(html).not.toContain("0 SOL");
 });
 it("starts collapsed and exposes no collection control",()=>{
  const html=renderToStaticMarkup(<GmgnQuote activityId={report.activity_id} address={report.address}/>);expect(html).toContain("Review SOL transfers &amp; fee basis");expect(html).not.toContain("989.454");expect(html).not.toContain("<button");
 });
});
