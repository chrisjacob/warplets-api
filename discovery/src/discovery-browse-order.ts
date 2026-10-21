import {DEFAULT_POLICY,type AssessedCandidate} from "./model";
import type {AnyScoreSummary} from "./discovery-score-models";

export type DiscoveryBrowse = {search?:string;freshness?:"all"|"fresh"|"stale"|"missing";min_liquidity?:number;min_coverage?:number;maximum?:100|500};
export type BrowseEntry={address:string;name:string;symbol:string;eligibility:AssessedCandidate["eligibility"];creation_at:string|null;score:number;coverage:number;liquidity:number|null;freshness:"fresh"|"stale"|"missing"};
type Input=Pick<AssessedCandidate,"address"|"name"|"symbol"|"eligibility"|"market">&{creation:{block_time:string}|null;discovery_score:AnyScoreSummary};
export function browseEntry(c:Input,at:Date):BrowseEntry {
  const m=c.market,elapsed=m?at.getTime()-Date.parse(m.fetched_at):null;
  const freshness=!m?"missing":elapsed!==null&&elapsed>=0&&elapsed<=DEFAULT_POLICY.max_market_age_seconds*1000&&(!m.observed_at||Date.parse(m.observed_at)<=at.getTime())?"fresh":"stale";
  return {address:c.address,name:c.name,symbol:c.symbol,eligibility:c.eligibility,creation_at:c.creation?.block_time??null,score:c.discovery_score.value,coverage:c.discovery_score.evidence_coverage,liquidity:m?.liquidity_usd??null,freshness};
}
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function browseEntries<T extends BrowseEntry>(rows:T[],sort:"score"|"liquidity",status:"all"|AssessedCandidate["eligibility"],browse:DiscoveryBrowse={}) {
  const counts={eligible:rows.filter(c=>c.eligibility==="eligible").length,provisional:rows.filter(c=>c.eligibility==="provisional").length,excluded:rows.filter(c=>c.eligibility==="excluded").length};
  const freshLiquidity=(c:T)=>c.freshness==="fresh"?c.liquidity??0:0;
  const ordered=rows.filter(c=>status==="all"||c.eligibility===status).sort((a,b)=>
    (sort==="score"?b.score-a.score||b.coverage-a.coverage:0)||freshLiquidity(b)-freshLiquidity(a)||ascii(a.creation_at??"~",b.creation_at??"~")||ascii(a.address,b.address));
  const search=(browse.search??"").trim(),text=search.toLowerCase();
  // Rank before search and presentation limits; exact low-ranked mints stay visible.
  const matching=ordered.map((c,i)=>({...c,discovery_rank:i+1})).filter(c=>{
    if(search&&c.address!==search&&!c.name.toLowerCase().includes(text)&&!c.symbol.toLowerCase().includes(text))return false;
    if(browse.freshness&&browse.freshness!=="all"&&browse.freshness!==c.freshness)return false;
    if((browse.min_liquidity??0)>0&&(c.liquidity===null||c.liquidity<browse.min_liquidity!))return false;
    return c.coverage>=(browse.min_coverage??0);
  });
  return {rows:matching.slice(0,browse.maximum??100),counts,observed:rows.length,matched:matching.length,ranked:ordered.length};
}
