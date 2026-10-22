// Offline synthetic journey lab. Not an application entry point or live evidence.
import {useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import DiscoveryPage from "../../app/src/discovery/DiscoveryPage";
import {fixtureCandidates} from "../../discovery/src/fixtures";
import {assess,DEFAULT_POLICY} from "../../discovery/src/model";
import {candidateCard} from "../../discovery/src/candidate-card";
import {hashJson} from "../../discovery/src/solana";
import {defaultScoreInputV4,freezeDiscoveryScoreV4,scoreSummaryV4} from "../../discovery/src/discovery-score-v4";

const at=new Date("2026-10-22T01:00:00.000Z"),cutoff=at.toISOString();
const raw=(await fixtureCandidates(at)).slice(0,3).map((c,i)=>({...c,name:`Journey token ${i+1}`,symbol:`QA${i+1}`,market:c.market?{...c.market,image_url:null,volume_24h_usd:i===1?null:c.market.volume_24h_usd,fetched_at:i===2?"2026-10-21T01:00:00.000Z":cutoff}:null}));
const candidates=await Promise.all(raw.map(async c=>({...assess(c,DEFAULT_POLICY,at),discovery_score:scoreSummaryV4(await freezeDiscoveryScoreV4(defaultScoreInputV4(c,at)))})));
const common={api_version:"10x-discovery-v1",trace_id:"offline-synthetic-journey",as_of:cutoff,served_at:cutoff,policy_version:DEFAULT_POLICY.version,source_freshness:{last_harvest:cutoff,last_success:cutoff,stale:false},coverage:{exhaustive:false,scope:"Synthetic browser journey",history_limit:0,quote_support:"Synthetic",holder_classification:"Unknown",market_enabled:false}};
const lab={ready:false,candidates:candidates.map(c=>({address:c.address,name:c.name})),requests:[] as {path:string;method:string}[],detailFailure:false};
Object.assign(window,{journeyLab:lab});
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url,location.href);
  if(url.origin!==location.origin||!url.pathname.startsWith("/api/10x/"))return nativeFetch(input,init);
  const method=init?.method??"GET";lab.requests.push({path:url.pathname+url.search,method});
  if(method!=="GET")throw Error("offline_lab_read_only");
  const json=(data:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}}));
  if(url.pathname==="/api/10x/candidates"){
    const q=(url.searchParams.get("q")??"").toLowerCase();
    const selected=candidates.filter(c=>!q||[c.address,c.name,c.symbol].some(v=>v.toLowerCase().includes(q)));
    return json({...common,data:{candidates:selected.map(candidateCard),mode:"fixture",sort:url.searchParams.get("sort")??"score",scored_at:cutoff,counts:{eligible:0,provisional:selected.length,excluded:0},scope:{inventory:"current_evaluation",stored:candidates.length,retained_total:candidates.length,ranked:candidates.length,matched:selected.length,available:selected.length,truncated:false,maximum:500,search_before_limit:true}},next_cursor:null});
  }
  if(url.pathname.startsWith("/api/10x/candidates/solana/")){
    const candidate=candidates.find(c=>c.address===url.pathname.split("/").at(-1));
    if(candidate&&!lab.detailFailure){const {discovery_score,...detail}=candidate;return json({...common,data:detail});}
    return json({error:"Synthetic evidence unavailable"},503);
  }
  if(url.pathname==="/api/10x/discovery/compare"){
    const addresses=(url.searchParams.get("addresses")??"").split(",");
    const payload={version:"discovery-comparison-v1",cutoff_at:cutoff,mode:"fixture",addresses,rows:await Promise.all(addresses.map(async address=>{const candidate=candidates.find(c=>c.address===address);return {address,state:candidate?"available":"not_found",candidate:candidate?candidateCard(candidate):null,candidate_hash:candidate?await hashJson(candidate):null,observations:[],gaps:candidate?[]:["outside_saved_inventory_no_provider_lookup"]};})),alignment:"shared_read_cutoff_source_windows_differ",source_authenticity:"not_independently_verified",scoring_model:"discovery-score-v4",activity_scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0};
    return json({...payload,report_hash:await hashJson(payload)});
  }
  // Optional panels honestly fail closed; no fallback requests reach a provider.
  return json({error:"Synthetic optional panel unavailable"},503);
};
function Lab(){
  const [path,setPath]=useState(location.pathname);
  useEffect(()=>{const pop=()=>setPath(location.pathname);window.addEventListener("popstate",pop);return()=>window.removeEventListener("popstate",pop);},[]);
  return <><aside role="note">OFFLINE SYNTHETIC JOURNEY — no provider evidence or release acceptance.</aside><DiscoveryPage path={path}/></>;
}
createRoot(document.getElementById("root")!).render(<Lab/>);lab.ready=true;
