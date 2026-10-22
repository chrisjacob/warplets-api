import{expect,it}from"vitest";
import{renderToStaticMarkup}from"react-dom/server";
import{GmgnEventSample,GmgnEventSampleValues}from"./GmgnEventSample";
import{type GmgnEventSampleReport}from"../../../discovery/src/gmgn-event-sample-model";
const report:GmgnEventSampleReport={version:"gmgn-event-sample-comparison-v1",activity_id:"10000000-0000-4000-8000-000000000001",address:"So11111111111111111111111111111111111111112",cutoff_at:"2026-10-21T09:01:00.000Z",source_report_hash:"a".repeat(64),plan_hash:"b".repeat(64),state:"cache_missing",page_events:50,selected_events:3,selected_trade_events:3,unselected_events:47,unselected_trade_events:45,required_transactions:2,cached_transactions:1,exact_quantity_events:1,aggregate_only_events:2,groups:[{events:1,parsed_instructions:1,status:"exact_instruction_quantities"},{events:2,parsed_instructions:1,status:"aggregate_quantity_only"}],gaps:["unselected_events_not_compared"],representative_sample:false,finality_independently_attested:false,usd_volume_verified:false,organic_volume_usd:null,live_collection_enabled:false,provider_requests:0,database_writes:0,scoring_effect:"none",evidence_gates_changed:false,input_hash:"c".repeat(64),report_hash:"d".repeat(64)};
it("shows full-page, selected and unexamined denominators with honest source limits",()=>{
  const html=renderToStaticMarkup(<GmgnEventSampleValues data={report}/>);
  for(const text of["Complete saved page: 50 events","Targeted selection: 3 events (3 trades) in 2 transactions","47 events (45 trades) remain unexamined","1 / 2 selected transaction bodies","1 / 3 selected trade events","2 events match only aggregate","not representative","Missing bodies are unknown","not a fraud verdict","scoring or action credit","Live RPC collection is disconnected","Plan hash:","Report hash:"])expect(html).toContain(text);
  expect(html).not.toContain("<button");expect(html).not.toContain("Signed cost");
});
it("shows a held sample without implying comparison or verified organic demand",()=>{
  const html=renderToStaticMarkup(<GmgnEventSampleValues data={{...report,state:"held",cached_transactions:0,exact_quantity_events:0,aggregate_only_events:0,groups:[]}}/>);
  expect(html).toContain("Comparison held by its bounds");expect(html).toContain("0 / 3 selected trade events");expect(html).not.toContain("Saved bodies compared");
});
it("starts collapsed without fetching or exposing collection controls",()=>{
  const html=renderToStaticMarkup(<GmgnEventSample activityId={report.activity_id} address={report.address}/>);
  expect(html).toContain("Compare targeted sample with saved transactions");expect(html).not.toContain("Complete saved page");expect(html).not.toContain("open=");expect(html).not.toContain("<button");
});
