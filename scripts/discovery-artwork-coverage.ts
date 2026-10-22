import {createHash} from "node:crypto";
import {CardListResponse} from "../app/src/discovery/client";
import {ArtworkResponseSchema} from "../discovery/src/artwork-model";
import {tokenImageSources} from "../discovery/src/images";

export const artworkCohortEndpoint="https://app-local.10x.meme/api/10x/candidates?mode=live&status=all&age=24h&sort=score&q=&freshness=all&min_liquidity=0&min_coverage=0&limit=100&view=cards&browse=inventory&inventory=current";
export const artworkDigest=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export function admitArtworkCohort(manifestBytes:string,candidateBytes:string,artworkBytes:string,expectedPin:string){
  if(!/^[a-f0-9]{64}$/.test(expectedPin)||artworkDigest(manifestBytes)!==expectedPin)throw Error("manifest_pin_mismatch");
  const manifest=JSON.parse(manifestBytes);
  if(manifest.version!==1||manifest.mode!=="live"||manifest.cohort_endpoint!==artworkCohortEndpoint||manifest.cache_gets!==2||manifest.provider_collection!==0||manifest.candidates_sha256!==artworkDigest(candidateBytes)||manifest.artwork_sha256!==artworkDigest(artworkBytes))throw Error("cohort_manifest_mismatch");
  const cohort=CardListResponse.parse(JSON.parse(candidateBytes)),artwork=ArtworkResponseSchema.parse(JSON.parse(artworkBytes)),data=cohort.data,cutoff=Date.parse(data.scored_at??"");
  const received=Date.parse(manifest.artwork_received_at),requested=Date.parse(manifest.artwork_requested_at),served=Date.parse(cohort.served_at);
  const source=Date.parse(cohort.as_of??""),scope=data.scope;
  if(data.mode!=="live"||data.sort!=="score"||![cutoff,received,requested,served,source].every(Number.isFinite)||source>cutoff||received<requested||requested<served||cutoff>served||manifest.cohort_served_at!==cohort.served_at||manifest.cohort_scored_at!==data.scored_at||manifest.cohort_source_as_of!==cohort.as_of||scope?.inventory!=="active_verified_first_day"||scope.maximum!==500||scope.available!==Math.min(500,scope.matched)||scope.matched>scope.ranked||scope.ranked>scope.stored||scope.retained_total===undefined||scope.retained_total<scope.stored||scope.truncated!==(scope.matched>scope.available)||data.candidates.length!==Math.min(100,scope.available)||data.candidates.length!==manifest.cohort_count||!data.candidates.length||(cohort.next_cursor!==null)!==(data.candidates.length<scope.available))throw Error("cohort_scope_mismatch");
  const addresses=new Set(data.candidates.map(c=>c.address));
  if(addresses.size!==data.candidates.length||Object.keys(artwork.data).some(a=>!addresses.has(a)))throw Error("cohort_identity_mismatch");
  for(const c of data.candidates){
    const created=Date.parse(c.creation?.block_time??""),age=cutoff-created;
    if(c.mode!=="live"||!Number.isFinite(created)||age<0||age>86400000||c.discovery_score?.version!=="discovery-score-v4"||c.discovery_score.as_of!==data.scored_at)throw Error("cohort_observation_mismatch");
  }
  const entries=data.candidates.map(c=>({address:c.address,name:c.name,symbol:c.symbol,market_url:c.market?.image_url??null,metadata_url:artwork.data[c.address]?.image_url??null,metadata_fetched_at:artwork.data[c.address]?.fetched_at??null,metadata_error:artwork.data[c.address]?.error??null,sources:tokenImageSources(c.market?.image_url,artwork.data[c.address]?.image_url)}));
  return {manifest,cohort,entries};
}
export type ArtworkCoverageEntry=ReturnType<typeof admitArtworkCohort>["entries"][number];
export type ArtworkRenderRow={address:string;visible:boolean;state:"loaded"|"unavailable"|"loading";attempted_sources:string[];loaded_source:string|null;natural_width:number;natural_height:number};
export function summarizeArtworkCoverage(entries:ArtworkCoverageEntry[],rows:ArtworkRenderRow[]){
  const identities=new Map(entries.map(e=>[e.address,e]));
  if(identities.size!==entries.length||rows.length!==entries.length||new Set(rows.map(r=>r.address)).size!==entries.length)throw Error("render_denominator_mismatch");
  for(const row of rows){
    const entry=identities.get(row.address);
    if(!entry||!['loaded','unavailable','loading'].includes(row.state)||typeof row.visible!=="boolean"||new Set(row.attempted_sources).size!==row.attempted_sources.length||row.attempted_sources.some(s=>!entry.sources.includes(s))||(!row.visible&&row.attempted_sources.length))throw Error("render_identity_mismatch");
    if(row.state==="loaded"&&(!row.loaded_source||!row.attempted_sources.includes(row.loaded_source)||!(row.natural_width>0&&row.natural_height>0)))throw Error("render_decode_unverified");
    if(row.state!=="loaded"&&row.loaded_source!==null)throw Error("render_state_mismatch");
    if(row.visible&&row.state==="unavailable"&&entry.sources.some(s=>!row.attempted_sources.includes(s)))throw Error("render_attempts_incomplete");
  }
  const visible=rows.filter(r=>r.visible),attempted=visible.filter(r=>r.attempted_sources.length>0),decoded=visible.filter(r=>r.state==="loaded"),missing=visible.filter(r=>!identities.get(r.address)!.sources.length),failed=visible.filter(r=>r.state==="unavailable"&&identities.get(r.address)!.sources.length),pending=visible.filter(r=>r.state==="loading");
  if(visible.length!==decoded.length+missing.length+failed.length+pending.length)throw Error("render_partition_mismatch");
  return {cohort_tokens:entries.length,visible_tokens:visible.length,not_visible_tokens:entries.length-visible.length,visible_with_allowed_source:visible.length-missing.length,visible_missing_source:missing.length,visible_attempted_tokens:attempted.length,visible_decoded_tokens:decoded.length,visible_failed_tokens:failed.length,visible_pending_tokens:pending.length,visible_source_attempts:attempted.reduce((n,r)=>n+r.attempted_sources.length,0),decoded_per_visible:visible.length?decoded.length/visible.length:null,decoded_per_attempted:attempted.length?decoded.length/attempted.length:null};
}
