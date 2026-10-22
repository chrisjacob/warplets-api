import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {DiscoveryYield} from "../../../discovery/src/discovery-yield-model";
import {DiscoveryYieldPanel,DiscoveryYieldValues} from "./DiscoveryYield";
const report=DiscoveryYield.parse({version:'discovery-yield-v1',cutoff:'2026-10-22T10:05:33.915Z',scope:'retained_pipeline_not_market',candidates:{retained:572,active:283,active_creation_unknown:182,created_24h:101,graduated_24h:105,graduated_24h_creation_unknown:4,with_market:571,fresh_market:19,fresh_reported_volume:19,active_fresh_market:19,active_fresh_reported_volume:19,invalid_cached_identity:0},leads:{observed:1217,unchecked:645,graduated_24h:376,unchecked_graduated_24h:271,invalid_cached_json:0},signatures:{observed:4934,pending:2397,oldest_pending_at:'2026-10-19T21:21:01.296Z'},harvest:{checkpoint:'migration_required',page_size:30,exhaustive:false},market_recall:'not_measured',ranking:'v4_structural_support',qualified_attention_in_rank:false,receipt_payloads_replayed:false,provider_requests:0,database_writes:0,evidence_gates_changed:false});
it("shows each pipeline denominator and explicitly withholds market quality and organic-attention conclusions",()=>{
  const html=renderToStaticMarkup(<DiscoveryYieldValues report={report}/>);for(const text of ['271 / 376','182 / 283','19 / 283','101 / 105','cannot tell us whether the wider market has good tokens','outside the default first-day view','not verified organic volume','receipts have not been replayed','voting/launch gates remain separate','new harvest is held'])expect(html).toContain(text);
  expect(html).not.toContain('No good tokens exist');expect(html).not.toContain('qualified volume passed');
});
it("keeps diagnostics opt-in with an honest unknown state and a usable wider-current-view link",()=>{
  const html=renderToStaticMarkup(<DiscoveryYieldPanel allCurrentHref='/discover?mode=live&age=all'/>);expect(html).toContain('Why Discovery can miss promising tokens');expect(html).toContain('older or unknown creation times');expect(html).toContain('Refresh pipeline counts');expect(html).not.toContain('2397');expect(html).not.toMatch(/<details[^>]* open/);
});
