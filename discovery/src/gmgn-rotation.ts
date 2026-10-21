import {z} from "zod";
import {Address,type Candidate} from "./model";
import {hashJson} from "./solana";
import {rankedDiscovery,scoreInventoryCandidates,type ScoredCandidate} from "./discovery-score-store";

// Founder concern cases remain regression fixtures, not recurring live targets.
export const GMGN_REGRESSION_MINTS=["ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump","AMK8R8NqJ18VQnxsoGgv75pZVLyAG24BafFfp3Zpump","CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump"] as const;
const Day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/), Time=z.string().datetime();
const Entry=z.object({address:Address,input_hash:z.string().regex(/^[a-f0-9]{64}$/),checked_at:Time,
  age_band:z.enum(["first_day","older","unknown"]),liquidity_band:z.enum(["below_25k","at_least_25k","unknown"]),
  v4_band:z.enum(["below_50","at_least_50"]),v4_score:z.number().min(0).max(100),
  verification:z.enum(["verified","provisional","rejected"]),last_selected_day:Day.nullable(),
  disposition:z.enum(["selected","not_selected","regression_fixture"]),tie_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const GmgnDailyCohort=z.object({version:z.literal("gmgn-daily-rotation-v1"),day:Day,cutoff:Time,
  source:z.literal("active_chain_observed_inventory"),selection_policy:z.literal("least_recent_then_age_liquidity_v4_diversity_then_day_hash_v1"),
  inventory:z.array(Entry).max(500),selected:z.array(Address).max(3),scoring_effect:z.literal("none")}).strict().refine(c=>{
    const addresses=c.inventory.map(r=>r.address),selected=c.inventory.filter(r=>r.disposition==="selected").map(r=>r.address);
    return c.day===c.cutoff.slice(0,10)&&new Set(addresses).size===addresses.length&&new Set(c.selected).size===c.selected.length
      &&selected.length===c.selected.length&&c.selected.every(a=>selected.includes(a))
      &&c.inventory.every(r=>(r.last_selected_day===null||r.last_selected_day<c.day)&&((GMGN_REGRESSION_MINTS as readonly string[]).includes(r.address)?r.disposition==="regression_fixture":r.disposition!=="regression_fixture"));
  },"gmgn_rotation_inventory_inconsistent");
export type DailyCohort=z.infer<typeof GmgnDailyCohort>;
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;

export async function selectGmgnDailyCohort(candidates:Candidate[],scored:ScoredCandidate[],at:Date,lastSelected=new Map<string,string>()):Promise<DailyCohort>{
  const day=at.toISOString().slice(0,10), scores=new Map(scored.map(c=>[c.address,c.discovery_score.value]));
  const unique=new Map<string,Candidate>();
  for(const c of candidates){if(c.mode!=="live")throw Error("gmgn_rotation_live_inventory_required");const prior=unique.get(c.address);if(!prior||c.checked_at>prior.checked_at)unique.set(c.address,c);else if(c.checked_at===prior.checked_at&&await hashJson(c)!==await hashJson(prior))throw Error("gmgn_rotation_conflicting_duplicate");}
  const inventory:DailyCohort["inventory"]=[];
  for(const c of [...unique.values()].sort((a,b)=>ascii(a.address,b.address))){
    const score=scores.get(c.address);if(score===undefined)throw Error("gmgn_rotation_missing_v4");
    const age=c.creation?at.getTime()-Date.parse(c.creation.block_time):null, liq=c.market?.liquidity_usd;
    inventory.push({address:c.address,input_hash:await hashJson(c),checked_at:c.checked_at,
      age_band:age===null||age<0?"unknown":age<=86400000?"first_day":"older",
      liquidity_band:liq==null?"unknown":liq<25000?"below_25k":"at_least_25k",v4_band:score<50?"below_50":"at_least_50",v4_score:score,
      verification:c.verification,last_selected_day:lastSelected.get(c.address)??null,
      disposition:(GMGN_REGRESSION_MINTS as readonly string[]).includes(c.address)?"regression_fixture":"not_selected",tie_hash:await hashJson({day,address:c.address})});
  }
  const selected:DailyCohort["inventory"]=[];
  const diversity=(r:DailyCohort["inventory"][number])=>(["age_band","liquidity_band","v4_band"] as const).map(key=>selected.some(s=>s[key]===r[key])?0:1);
  while(selected.length<3){
    const remaining=inventory.filter(r=>r.disposition==="not_selected").sort((a,b)=>{
      const recency=ascii(a.last_selected_day??"",b.last_selected_day??"");if(recency)return recency;
      const da=diversity(a),db=diversity(b);return db[0]!-da[0]!||db[1]!-da[1]!||db[2]!-da[2]!||ascii(a.tie_hash,b.tie_hash)||ascii(a.address,b.address);
    });
    if(!remaining[0])break;remaining[0].disposition="selected";selected.push(remaining[0]);
  }
  return GmgnDailyCohort.parse({version:"gmgn-daily-rotation-v1",day,cutoff:at.toISOString(),source:"active_chain_observed_inventory",selection_policy:"least_recent_then_age_liquidity_v4_diversity_then_day_hash_v1",inventory,selected:selected.map(r=>r.address),scoring_effect:"none"});
}
export async function readGmgnDailyCohort(db:D1Database,day:string){
  Day.parse(day);const row=await db.prepare("SELECT payload,payload_hash FROM tenx_gmgn_daily_cohorts WHERE day=?1").bind(day).first<{payload:string;payload_hash:string}>();
  if(!row)return null;const manifest=GmgnDailyCohort.parse(JSON.parse(row.payload));
  if(manifest.day!==day||await hashJson(manifest)!==row.payload_hash)throw Error("gmgn_rotation_hash_mismatch");
  return {manifest,manifest_hash:row.payload_hash};
}
export async function freezeGmgnDailyCohort(db:D1Database,at:Date){
  const day=at.toISOString().slice(0,10),prior=await readGmgnDailyCohort(db,day);if(prior)return prior;
  // Reuse logical expiry, retaining every active unknown/rejected row. Expired
  // candidates and their evidence remain stored and searchable in the all view.
  const inventory=await scoreInventoryCandidates(db,"live",false);
  const scored=await rankedDiscovery(db,inventory,at,"score","all",{maximum:500});
  const history=await db.prepare(`SELECT j.value AS address,max(c.day) AS day FROM tenx_gmgn_daily_cohorts c,json_each(c.payload,'$.selected') j
    WHERE c.day<?1 AND j.value IN (SELECT value FROM json_each(?2)) GROUP BY j.value LIMIT 500`).bind(day,JSON.stringify(inventory.map(c=>c.address))).all<{address:string;day:string}>();
  const manifest=await selectGmgnDailyCohort(inventory,scored.rows,at,new Map(history.results.map(r=>[r.address,r.day]))), hash=await hashJson(manifest);
  await db.prepare("INSERT OR IGNORE INTO tenx_gmgn_daily_cohorts(day,cutoff,payload,payload_hash) VALUES(?1,?2,?3,?4)").bind(day,manifest.cutoff,JSON.stringify(manifest),hash).run();
  return (await readGmgnDailyCohort(db,day))!;
}
