import {test} from "node:test";
import assert from "node:assert/strict";
import {admitArtworkCohort,artworkCohortEndpoint,artworkDigest,summarizeArtworkCoverage,type ArtworkCoverageEntry,type ArtworkRenderRow} from "./discovery-artwork-coverage";
import {fixtureCandidates} from "../discovery/src/fixtures";
import {assess,DEFAULT_POLICY} from "../discovery/src/model";
import {candidateCard} from "../discovery/src/candidate-card";
import {defaultScoreInputV4,freezeDiscoveryScoreV4,scoreSummaryV4} from "../discovery/src/discovery-score-v4";
const at=new Date("2026-10-22T01:00:00.000Z"),stamp=at.toISOString(),url='https://cdn.dexscreener.com/token.png';
async function input(){
  const c={...(await fixtureCandidates(at))[0]!,mode:"live" as const},card=candidateCard({...assess(c,DEFAULT_POLICY,at),discovery_score:scoreSummaryV4(await freezeDiscoveryScoreV4(defaultScoreInputV4(c,at)))});
  const cohort={api_version:"10x-discovery-v1",trace_id:"synthetic",as_of:stamp,served_at:stamp,policy_version:DEFAULT_POLICY.version,source_freshness:{last_harvest:stamp,last_success:stamp,stale:false},coverage:{exhaustive:false,scope:"Synthetic",history_limit:0,quote_support:"Synthetic",holder_classification:"Unknown",market_enabled:false},data:{candidates:[card],mode:"live",sort:"score",scored_at:stamp,counts:{eligible:0,provisional:1,excluded:0},scope:{inventory:"active_verified_first_day",stored:1,retained_total:1,ranked:1,matched:1,available:1,truncated:false,maximum:500,search_before_limit:true}},next_cursor:null};
  const art={data:{[c.address]:{image_url:url,metadata_uri:null,creation_hash:'a'.repeat(64),metadata_hash:null,fetched_at:stamp,error:null}}};
  const encode=()=>{const candidates=JSON.stringify(cohort),artwork=JSON.stringify(art),manifest=JSON.stringify({version:1,mode:"live",cohort_endpoint:artworkCohortEndpoint,cache_gets:2,provider_collection:0,candidates_sha256:artworkDigest(candidates),artwork_sha256:artworkDigest(artwork),artwork_requested_at:stamp,artwork_received_at:stamp,cohort_served_at:cohort.served_at,cohort_scored_at:cohort.data.scored_at,cohort_source_as_of:cohort.as_of,cohort_count:1});return [manifest,candidates,artwork,artworkDigest(manifest)] as const;};
  return {cohort,art,encode};
}
test("pins both cache reads and admits exact dated live first-page identities without granting evidence credit",async()=>{
  const i=await input(),bytes=i.encode(),admitted=admitArtworkCohort(...bytes);assert.equal(admitted.entries.length,1);assert(admitted.entries[0]!.sources.includes(url));
  assert.throws(()=>admitArtworkCohort(bytes[0],bytes[1]+' ',bytes[2],bytes[3]),/manifest_mismatch/);assert.throws(()=>admitArtworkCohort(bytes[0],bytes[1],bytes[2],'b'.repeat(64)),/pin_mismatch/);
});
test("rejects wrong inventory, source mode, mint joins, scoring cutoff and creation window even when freshly repinned",async()=>{
  for(const mutate of [(i:Awaited<ReturnType<typeof input>>)=>{i.cohort.data.scope.inventory='retained';},(i:Awaited<ReturnType<typeof input>>)=>{i.cohort.data.candidates[0]!.mode='fixture';},(i:Awaited<ReturnType<typeof input>>)=>{i.art.data['11111111111111111111111111111111']=i.art.data[i.cohort.data.candidates[0]!.address]!;},(i:Awaited<ReturnType<typeof input>>)=>{i.cohort.data.candidates[0]!.creation!.block_time='2026-10-20T01:00:00.000Z';},(i:Awaited<ReturnType<typeof input>>)=>{i.cohort.data.scored_at='2026-10-22T01:01:00.000Z';}]){const i=await input();mutate(i);assert.throws(()=>admitArtworkCohort(...i.encode()));}
});
test("invalid dates and contradictory paging denominators cannot become admitted through a fresh manifest pin",async()=>{
  const missingDate=await input();missingDate.cohort.served_at='invalid';assert.throws(()=>admitArtworkCohort(...missingDate.encode()));
  const badCounts=await input();badCounts.cohort.data.scope.ranked=0;assert.throws(()=>admitArtworkCohort(...badCounts.encode()));
  const badCursor=await input();Object.assign(badCursor.cohort,{next_cursor:'unexpected'});assert.throws(()=>admitArtworkCohort(...badCursor.encode()));
});
const entry=(address:string,sources:string[]):ArtworkCoverageEntry=>({address,name:address,symbol:address,market_url:null,metadata_url:null,metadata_fetched_at:null,metadata_error:null,sources});
const row=(address:string,patch:Partial<ArtworkRenderRow>={}):ArtworkRenderRow=>({address,visible:true,state:'unavailable',attempted_sources:[],loaded_source:null,natural_width:0,natural_height:0,...patch});
test("keeps visible/attempted/decoded/missing/failed and off-screen denominators distinct",()=>{
  const entries=[entry('loaded',[url]),entry('failed',[url]),entry('missing',[]),entry('offscreen',[url])],rows=[row('loaded',{state:'loaded',attempted_sources:[url],loaded_source:url,natural_width:64,natural_height:64}),row('failed',{attempted_sources:[url]}),row('missing'),row('offscreen',{visible:false,state:'loading'})],summary=summarizeArtworkCoverage(entries,rows);
  assert.equal(summary.cohort_tokens,4);assert.equal(summary.visible_tokens,3);assert.equal(summary.visible_attempted_tokens,2);assert.equal(summary.visible_decoded_tokens,1);assert.equal(summary.visible_missing_source,1);assert.equal(summary.visible_failed_tokens,1);assert.equal(summary.not_visible_tokens,1);assert.equal(summary.decoded_per_visible,1/3);assert.equal(summary.decoded_per_attempted,1/2);
});
test("a URL, attempted request or nonzero dimensions alone cannot pass decoding; missing rows and foreign sources hold",()=>{
  const entries=[entry('one',[url])];
  for(const rows of [[],[row('one'),row('one')],[row('other')],[row('one',{state:'loaded',loaded_source:url,natural_width:64,natural_height:64})],[row('one',{state:'loaded',attempted_sources:[url],loaded_source:url})],[row('one',{attempted_sources:['https://evil.example/image.png']})],[row('one')]])assert.throws(()=>summarizeArtworkCoverage(entries,rows));
  assert.equal(summarizeArtworkCoverage(entries,[row('one',{state:'loading',attempted_sources:[url],natural_width:64,natural_height:64})]).visible_pending_tokens,1);
});
