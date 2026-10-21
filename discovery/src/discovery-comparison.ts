import {z} from "zod";
import {CandidateSchema,type Candidate} from "./model";
import {candidateCard} from "./candidate-card";
import {rankedDiscovery} from "./discovery-score-store";
import {commonActivityBundle} from "./activity-observation-store";
import {hashJson} from "./solana";
import {ComparisonAddresses,ComparisonRow,DiscoveryComparison} from "./discovery-comparison-model";
export {ComparisonAddresses} from "./discovery-comparison-model";
export async function discoveryComparison(db:D1Database,rawAddresses:string[],mode:"live"|"fixture",at=new Date()):Promise<DiscoveryComparison>{
  const addresses=ComparisonAddresses.parse(rawAddresses),cutoff_at=at.toISOString(),rows:z.infer<typeof ComparisonRow>[]=[];
  const saved=await db.prepare(`SELECT address,CASE WHEN length(CAST(payload AS BLOB))<=1600000 THEN payload ELSE NULL END AS payload FROM tenx_candidates
    WHERE mode=?1 AND address IN (SELECT value FROM json_each(?2)) ORDER BY address LIMIT 3`).bind(mode,JSON.stringify(addresses)).all<{address:string;payload:string|null}>();
  const candidates=new Map<string,Candidate>();
  for(const address of addresses){
    const row=saved.results.find(r=>r.address===address);
    if(!row){rows.push({address,state:"not_found",candidate:null,candidate_hash:null,observations:[],gaps:["outside_saved_inventory_no_provider_lookup"]});continue;}
    try{
      if(!row.payload)throw Error("comparison_candidate_size");const c=CandidateSchema.parse(JSON.parse(row.payload));
      if(c.address!==address||c.mode!==mode||Date.parse(c.checked_at)>at.getTime()||Date.parse(c.first_seen_at)>at.getTime())throw Error("comparison_candidate_identity_or_cutoff");
      candidates.set(address,c);rows.push({address,state:"available",candidate:null,candidate_hash:await hashJson(c),observations:[],gaps:[]});
    }catch{rows.push({address,state:"held",candidate:null,candidate_hash:null,observations:[],gaps:["candidate_unusable_or_after_cutoff"]});}
  }
  // Each row is independent: an unavailable source/token cannot hide the others.
  for(const row of rows){
    const c=candidates.get(row.address);if(!c)continue;
    try{
      const ranked=await rankedDiscovery(db,[c],at,"score","all");
      const {discovery_rank:omittedRank,...scored}=ranked.rows[0]!;
      // A one-token assessment has no meaningful global discovery rank.
      const marketFuture=c.market&&(Date.parse(c.market.fetched_at)>at.getTime()||c.market.observed_at!==null&&Date.parse(c.market.observed_at)>at.getTime());
      row.candidate=candidateCard({...scored,market:marketFuture?null:scored.market});
      if(marketFuture)row.gaps.push("market_snapshot_after_cutoff_withheld");
    }catch{row.gaps.push("score_inputs_unusable_grade_withheld");}
    const activity=await commonActivityBundle(db,c,at);row.observations=activity.records;row.recent_activity=activity.recent;row.holder_participation=activity.participation;row.trade_sample=activity.trades;
  }
  const payload={version:"discovery-comparison-v1" as const,cutoff_at,mode,addresses,rows,alignment:"shared_read_cutoff_source_windows_differ" as const,source_authenticity:"not_independently_verified" as const,
    scoring_model:"discovery-score-v4" as const,activity_scoring_effect:"none" as const,evidence_gates_changed:false as const,provider_requests:0 as const,database_writes:0 as const};
  return DiscoveryComparison.parse({...payload,report_hash:await hashJson(payload)});
}
