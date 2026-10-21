import{describe,expect,it}from"vitest";
import{renderToStaticMarkup}from"react-dom/server";
import{GmgnCorroboration,GmgnCorroborationValues}from"./GmgnCorroboration";
import{type GmgnCorroborationReport}from"../../../discovery/src/gmgn-corroboration-model";
const report:GmgnCorroborationReport={version:"gmgn-rpc-comparison-v1",activity_id:"10000000-0000-4000-8000-000000000001",address:"So11111111111111111111111111111111111111112",cutoff_at:"2026-10-21T09:01:00.000Z",activity_received_at:"2026-10-21T09:00:20.000Z",activity_report_hash:"a".repeat(64),status:"compared_sample",required_transactions:2,cached_transactions:1,reported_trade_events:3,non_trade_events:1,exact_quantity_events:1,aggregate_only_events:2,groups:[{events:1,parsed_instructions:1,status:"exact_instruction_quantities"},{events:2,parsed_instructions:1,status:"aggregate_quantity_only"}],gaps:["usd_valuation_unverified"],finality_independently_attested:false,usd_volume_verified:false,organic_volume_usd:null,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0,input_hash:"b".repeat(64),report_hash:"c".repeat(64)};
describe("saved GMGN RPC comparison presentation",()=>{
 it("separates exact and aggregate matches from finality, USD and organic claims",()=>{
  const html=renderToStaticMarkup(<GmgnCorroborationValues data={report}/>);for(const text of["1 / 2 required transaction bodies","1 / 3 reported trade events","2 events match only aggregate","1 non-trade events are excluded","not a fraud verdict","not independent finality attestation","No organic-volume, scoring or action credit"])expect(html).toContain(text);expect(html).not.toContain("<button");
 });
 it("shows absent cache as unknown and reports bounds explicitly",()=>{
  const html=renderToStaticMarkup(<GmgnCorroborationValues data={{...report,status:"held",cached_transactions:0,exact_quantity_events:0,aggregate_only_events:0,groups:[{events:3,parsed_instructions:0,status:"cache_missing"}]}}/>);for(const text of["Comparison held","Missing bodies are unknown","cache missing","0 / 3"])expect(html).toContain(text);
 });
 it("starts collapsed with no collection control or claim of a loaded result",()=>{
  const html=renderToStaticMarkup(<GmgnCorroboration activityId={report.activity_id} address={report.address}/>);expect(html).toContain("Compare with saved RPC transactions");expect(html).not.toContain("reported trade events match");expect(html).not.toContain("<button");
 });
});
