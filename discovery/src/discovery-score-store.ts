import {assess,shortlist,CandidateSchema,DEFAULT_POLICY,type Candidate,type AssessedCandidate} from "./model";
import {DISCOVERY_SCORE_POLICY,ScorePriceSchema,type ScoreInput} from "./discovery-score-model";
import {DiscoveryScoreError} from "./discovery-score";
import {defaultScoreInputV3,freezeDiscoveryScoreV3,scoreSummaryV3} from "./discovery-score-v3";
import {DISCOVERY_SCORE_POLICY_V2} from "./discovery-score-v2-model";
import type {AnyScoreSummary} from "./discovery-score-models";
import {FirstMarketSchema,type ScoreInputV3} from "./discovery-score-v3-model";

export async function scoreInventoryCandidates(db:D1Database,mode:"live"|"fixture",retained:boolean) {
  const rows=await db.prepare(`SELECT CASE WHEN count(*) OVER()>500 OR sum(length(CAST(payload AS BLOB))) OVER()>4000000 OR max(length(CAST(payload AS BLOB))) OVER()>1600000 THEN NULL ELSE payload END AS payload
    FROM ${retained?"tenx_candidates":"tenx_active_candidates"} WHERE mode=?1 ORDER BY address LIMIT 501`).bind(mode).all<{payload:string|null}>();
  if(rows.results.length>500)throw new DiscoveryScoreError("discovery_score_inventory_limit");
  if(rows.results.some(r=>r.payload===null))throw new DiscoveryScoreError("discovery_score_input_size_limit");
  return rows.results.map(r=>CandidateSchema.parse(JSON.parse(r.payload!)));
}
export async function scorePriceInputs(db:D1Database,addresses:string[],at:Date) {
  return boundedScorePrices(db,addresses,at,DISCOVERY_SCORE_POLICY.performance.window_seconds,64);
}
export async function scoreIntegrityPriceInputs(db:D1Database,addresses:string[],at:Date) {
  return boundedScorePrices(db,addresses,at,DISCOVERY_SCORE_POLICY_V2.integrity.history_seconds,256);
}
async function boundedScorePrices(db:D1Database,addresses:string[],at:Date,windowSeconds:number,maxSamples:number) {
  const result=new Map<string,{prices:ScoreInput["prices"];history_limited:boolean}>();
  if(!addresses.length)return result;
  if(addresses.length>500)throw new DiscoveryScoreError("discovery_score_inventory_limit");
  const rows=await db.prepare(`SELECT address,fetched_at,source,observed_at,price_usd,snapshot_at,total FROM (
    SELECT address,fetched_at,json_extract(payload,'$.fetched_at') AS snapshot_at,json_extract(payload,'$.source') AS source,json_extract(payload,'$.observed_at') AS observed_at,json_extract(payload,'$.price_usd') AS price_usd,
    row_number() OVER(PARTITION BY address ORDER BY fetched_at DESC) AS ordinal,count(*) OVER(PARTITION BY address) AS total
    FROM tenx_market_history WHERE address IN (SELECT value FROM json_each(?1)) AND fetched_at>=?2 AND fetched_at<=?3
  ) WHERE ordinal<=?4 ORDER BY address,fetched_at LIMIT ?5`).bind(JSON.stringify(addresses),new Date(at.getTime()-windowSeconds*1000).toISOString(),at.toISOString(),maxSamples,maxSamples>64?16001:32001).all<{address:string;fetched_at:string;source:string;observed_at:string|null;price_usd:number|null;snapshot_at:string;total:number}>();
  if(rows.results.length>(maxSamples>64?16000:32000))throw new DiscoveryScoreError("discovery_score_history_inventory_limit");
  for(const r of rows.results){
    if(r.fetched_at!==r.snapshot_at)throw new DiscoveryScoreError("discovery_score_price_identity_mismatch");
    const current=result.get(r.address)??{prices:[],history_limited:r.total>maxSamples};
    current.prices.push(ScorePriceSchema.parse({source:r.source,fetched_at:r.fetched_at,observed_at:r.observed_at,price_usd:r.price_usd}));result.set(r.address,current);
  }
  return result;
}
export type ScoredCandidate=AssessedCandidate&{discovery_score:AnyScoreSummary;discovery_rank:number};
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
export async function rankedDiscovery(db:D1Database,candidates:Candidate[],at:Date,sort:"score"|"liquidity",status:"all"|"eligible"|"provisional"|"excluded") {
  const unique=new Map<string,Candidate>();for(const c of candidates){const prior=unique.get(c.address);if(!prior||prior.checked_at<c.checked_at)unique.set(c.address,c);}
  const source=[...unique.values()],prices=await scoreIntegrityPriceInputs(db,source.filter(c=>c.mode==="live").map(c=>c.address),at);
  const firstMarkets=await scoreFirstMarkets(db,source.filter(c=>c.mode==="live").map(c=>c.address),at);
  const actionRanks=new Map(shortlist(source,DEFAULT_POLICY,at).filter(c=>c.rank!==null).map(c=>[c.address,c.rank]));
  const rows=await Promise.all(source.map(async candidate=>{
    const history=prices.get(candidate.address),record=await freezeDiscoveryScoreV3(defaultScoreInputV3(candidate,at,history?.prices??[],history?.history_limited??false,firstMarkets.get(candidate.address)??null));
    return {...assess(candidate,DEFAULT_POLICY,at),rank:actionRanks.get(candidate.address)??null,discovery_score:scoreSummaryV3(record),discovery_rank:0};
  }));
  const counts={eligible:rows.filter(c=>c.eligibility==="eligible").length,provisional:rows.filter(c=>c.eligibility==="provisional").length,excluded:rows.filter(c=>c.eligibility==="excluded").length};
  const freshLiquidity=(c:ScoredCandidate)=>c.market&&Date.parse(c.market.fetched_at)<=at.getTime()&&(!c.market.observed_at||Date.parse(c.market.observed_at)<=at.getTime())&&at.getTime()-Date.parse(c.market.fetched_at)<=180000?c.market.liquidity_usd??0:0;
  const ordered=rows.filter(c=>status==="all"||c.eligibility===status).sort((a,b)=>
    (sort==="score"?b.discovery_score.value-a.discovery_score.value||b.discovery_score.evidence_coverage-a.discovery_score.evidence_coverage:0)||freshLiquidity(b)-freshLiquidity(a)||ascii(a.creation?.block_time??"~",b.creation?.block_time??"~")||ascii(a.address,b.address));
  return {rows:ordered.slice(0,100).map((c,i)=>({...c,discovery_rank:i+1})),counts,observed:rows.length};
}
export async function candidateScorecard(db:D1Database,address:string,mode:"live"|"fixture",at=new Date()) {
  const row=await db.prepare("SELECT CASE WHEN length(CAST(payload AS BLOB))<=1600000 THEN payload ELSE NULL END AS payload FROM tenx_candidates WHERE mode=?1 AND address=?2").bind(mode,address).first<{payload:string|null}>();
  if(!row)return null;if(!row.payload)throw new DiscoveryScoreError("discovery_score_input_size_limit");
  const candidate=CandidateSchema.parse(JSON.parse(row.payload)),history=mode==="live"?(await scoreIntegrityPriceInputs(db,[address],at)).get(address):undefined;
  const firstMarkets=mode==="live"?await scoreFirstMarkets(db,[address],at):new Map();
  return freezeDiscoveryScoreV3(defaultScoreInputV3(candidate,at,history?.prices??[],history?.history_limited??false,firstMarkets.get(candidate.address)??null));
}

// Earliest retained quote, not a reconstructed first trade. Project bounded fields
// across all retained history so later refreshes cannot masquerade as launch data.
export async function scoreFirstMarkets(db:D1Database,addresses:string[],at:Date){
  const result=new Map<string,NonNullable<ScoreInputV3["first_market"]>>();
  if(!addresses.length)return result;
  if(addresses.length>500)throw new DiscoveryScoreError("discovery_score_inventory_limit");
  const rows=await db.prepare(`SELECT address,fetched_at,snapshot_at,source,observed_at,market_cap_usd FROM (
    SELECT address,fetched_at,json_extract(payload,'$.fetched_at') AS snapshot_at,json_extract(payload,'$.source') AS source,json_extract(payload,'$.observed_at') AS observed_at,json_extract(payload,'$.market_cap_usd') AS market_cap_usd,
    row_number() OVER(PARTITION BY address ORDER BY fetched_at) AS ordinal
    FROM tenx_market_history WHERE address IN (SELECT value FROM json_each(?1)) AND fetched_at<=?2
  ) WHERE ordinal=1 ORDER BY address LIMIT 500`).bind(JSON.stringify(addresses),at.toISOString()).all<{address:string;fetched_at:string;snapshot_at:string;source:string;observed_at:string|null;market_cap_usd:number|null}>();
  for(const r of rows.results){if(r.fetched_at!==r.snapshot_at)throw new DiscoveryScoreError("discovery_score_first_market_identity_mismatch");result.set(r.address,FirstMarketSchema.parse({source:r.source,fetched_at:r.fetched_at,observed_at:r.observed_at,market_cap_usd:r.market_cap_usd}));}
  return result;
}
