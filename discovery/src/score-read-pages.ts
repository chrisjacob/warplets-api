import {z} from "zod";
import {Address,DEFAULT_POLICY} from "./model";
import {CandidateCardSchema,candidateCard} from "./candidate-card";
import {ScoreSummaryV4Schema,DISCOVERY_SCORE_POLICY_V4} from "./discovery-score-v4-model";
import {rankedDiscovery,scoreInventoryCandidates} from "./discovery-score-store";
import {browseEntries,browseEntry} from "./discovery-browse-order";
import {hashJson} from "./solana";
import {control} from "./store";

// Bump on evaluator/browse semantics changes, even if numeric policies do not change.
const VERSION="discovery-score-read-pages-v1" as const,WINDOW_MS=60000;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Eligibility=z.enum(["eligible","provisional","excluded"]);
const Card=CandidateCardSchema.omit({discovery_rank:true}).extend({discovery_score:ScoreSummaryV4Schema});
const Entry=z.object({address:Address,name:z.string().max(100),symbol:z.string().max(32),eligibility:Eligibility,creation_at:z.iso.datetime().nullable(),
  score:z.number().finite().min(0).max(100),coverage:z.number().finite().min(0).max(100),liquidity:z.number().finite().nonnegative().nullable(),freshness:z.enum(["fresh","stale","missing"]),card_hash:Hash}).strict();
const Manifest=z.object({version:z.literal(VERSION),policy_hash:Hash,source_revision:z.number().int().safe().nonnegative(),cutoff:z.iso.datetime(),expires_at:z.iso.datetime(),
  scope:z.literal("current_evaluation"),semantics:z.literal("frozen_at_cutoff"),action_authority:z.literal(false),entries:Entry.array().max(500)}).strict();
const Query=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),status:z.enum(["all","eligible","provisional","excluded"]).default("all"),age:z.enum(["all","24h"]).default("all"),
  sort:z.enum(["score","liquidity"]).default("score"),browse:z.enum(["top100","inventory"]).default("top100"),q:z.string().trim().max(100).default(""),
  freshness:z.enum(["all","fresh","stale","missing"]).default("all"),min_liquidity:z.coerce.number().finite().min(0).max(1e12).default(0),min_coverage:z.coerce.number().finite().min(0).max(100).default(0),cursor:z.string().max(512).optional()}).strict();
const Cursor=z.object({manifest_hash:Hash,offset:z.number().int().min(0).max(500),identity:Hash}).strict();
const policyHash=()=>hashJson({contract:VERSION,score:DISCOVERY_SCORE_POLICY_V4,actions:DEFAULT_POLICY});
const held=(reason:string)=>({state:"held" as const,reason,action_authority:false as const});
const bytes=(s:string)=>new TextEncoder().encode(s).byteLength;

export async function buildScoreReadPages(db:D1Database,at=new Date()) {
  if((await control(db)).paused)return held("paused");
  let revision:number|null;
  try {revision=await db.prepare("SELECT revision FROM tenx_score_source_revision WHERE id=1").first<number>("revision");
    // Do not begin expensive evaluation if the new migration is unavailable.
    await db.prepare("SELECT id FROM tenx_score_page_manifest WHERE id=1").first();
  }catch{return held("read_pages_unavailable");}
  if(revision===null)return held("source_revision_missing");
  const source=await scoreInventoryCandidates(db,"live",false),ranked=await rankedDiscovery(db,source,at,"score","all",{maximum:500});
  const cards=ranked.rows.map(row=>{const {discovery_rank:ignored,...card}=candidateCard(row);return Card.parse(card);});
  const payloads=cards.map(card=>JSON.stringify(card));
  if(payloads.some(p=>bytes(p)>16000)||payloads.reduce((n,p)=>n+bytes(p),0)>1800000)return held("card_size_limit");
  const entries=await Promise.all(cards.map(async card=>({...browseEntry(card,at),card_hash:await hashJson(card)})));
  const manifest=Manifest.parse({version:VERSION,policy_hash:await policyHash(),source_revision:revision,cutoff:at.toISOString(),expires_at:new Date(at.getTime()+WINDOW_MS).toISOString(),
    scope:"current_evaluation",semantics:"frozen_at_cutoff",action_authority:false,entries});
  const payload=JSON.stringify(manifest);if(bytes(payload)>600000)return held("manifest_size_limit");
  const hash=await hashJson(manifest),input=JSON.stringify(cards.map((c,i)=>({address:c.address,payload:payloads[i]})));
  if(bytes(input)>1800000)return held("card_batch_size_limit");
  // D1 batch is one transaction. All three statements use the same admission;
  // a rejected builder leaves the previous complete generation untouched.
  const guard=`EXISTS(SELECT 1 FROM tenx_score_source_revision WHERE id=1 AND revision=?1)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)
    AND NOT EXISTS(SELECT 1 FROM tenx_score_page_manifest WHERE cutoff>?2)`;
  const result=await db.batch([
    db.prepare(`DELETE FROM tenx_score_page_cards WHERE ${guard}`).bind(revision,manifest.cutoff),
    db.prepare(`INSERT INTO tenx_score_page_cards(address,manifest_hash,payload)
      SELECT json_extract(value,'$.address'),?3,json_extract(value,'$.payload') FROM json_each(?4) WHERE ${guard}`).bind(revision,manifest.cutoff,hash,input),
    db.prepare(`INSERT INTO tenx_score_page_manifest(id,source_revision,cutoff,manifest_hash,payload)
      SELECT 1,?1,?2,?3,?4 WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET source_revision=excluded.source_revision,cutoff=excluded.cutoff,manifest_hash=excluded.manifest_hash,payload=excluded.payload`).bind(revision,manifest.cutoff,hash,payload),
  ]);
  if(result[2]!.meta.changes!==1)return held("source_changed_paused_or_newer_snapshot");
  return {state:"built" as const,manifest_hash:hash,cutoff:manifest.cutoff,candidates:cards.length,manifest_bytes:bytes(payload),card_bytes:payloads.reduce((n,p)=>n+bytes(p),0),action_authority:false as const};
}

export async function readScoreReadPages(db:D1Database,raw:unknown={},now=new Date()) {
  const query=Query.parse(raw),{cursor:ignored,limit:ignoredLimit,...filters}=query,identity=await hashJson(filters);
  let cursor:z.infer<typeof Cursor>|null=null;
  if(query.cursor){try {cursor=Cursor.parse(JSON.parse(atob(query.cursor)));}catch{return held("invalid_cursor");}if(cursor.identity!==identity)return held("cursor_refresh_required");}
  let row:{revision:number;source_revision:number|null;cutoff:string|null;manifest_hash:string|null;payload:string|null}|null;
  try {row=await db.prepare(`SELECT r.revision,m.source_revision,m.cutoff,m.manifest_hash,
    CASE WHEN m.source_revision=r.revision AND length(CAST(m.payload AS BLOB))<=600000 THEN m.payload ELSE NULL END AS payload
    FROM tenx_score_source_revision r LEFT JOIN tenx_score_page_manifest m ON m.id=r.id WHERE r.id=1`).first<NonNullable<typeof row>>();}
  catch{return held("read_pages_unavailable");}
  if(!row||row.source_revision===null)return held("missing");
  if(row.revision!==row.source_revision)return held("source_changed");
  let manifest:z.infer<typeof Manifest>;
  try {manifest=Manifest.parse(JSON.parse(row.payload??"null"));}catch{return held("invalid_manifest");}
  if(manifest.source_revision!==row.source_revision||manifest.cutoff!==row.cutoff||await hashJson(manifest)!==row.manifest_hash)return held("manifest_integrity_mismatch");
  if(manifest.policy_hash!==await policyHash())return held("policy_changed");
  const cutoff=Date.parse(manifest.cutoff),time=now.getTime();
  if(!Number.isFinite(time)||Date.parse(manifest.expires_at)!==cutoff+WINDOW_MS||time<cutoff||time>=cutoff+WINDOW_MS)return held("cutoff_expired_or_future");
  if(cursor&&cursor.manifest_hash!==row.manifest_hash)return held("cursor_refresh_required");
  if(new Set(manifest.entries.map(e=>e.address)).size!==manifest.entries.length)return held("inventory_mismatch");
  const population=query.age==="all"?manifest.entries:manifest.entries.filter(e=>e.creation_at!==null&&cutoff-Date.parse(e.creation_at)>=0&&cutoff-Date.parse(e.creation_at)<=86400000);
  const ranked=browseEntries(population,query.sort,query.status,{search:query.q,freshness:query.freshness,min_liquidity:query.min_liquidity,min_coverage:query.min_coverage,maximum:query.browse==="inventory"?500:100});
  const offset=cursor?.offset??0;if(offset>ranked.rows.length)return held("cursor_refresh_required");
  const selected=ranked.rows.slice(offset,offset+query.limit);
  // Recheck the generation and source revision in the card lookup itself. Even
  // empty results must observe this barrier, so concurrent changes never pass.
  let loaded:{address:string|null;payload:string|null}[];
  try {loaded=(await db.prepare(`SELECT c.address,CASE WHEN length(CAST(c.payload AS BLOB))<=16000 THEN c.payload ELSE NULL END AS payload
    FROM tenx_score_source_revision r JOIN tenx_score_page_manifest m ON m.id=r.id
    LEFT JOIN json_each(?1) wanted ON true LEFT JOIN tenx_score_page_cards c ON c.address=wanted.value AND c.manifest_hash=m.manifest_hash
    WHERE r.id=1 AND r.revision=?2 AND m.source_revision=r.revision AND m.manifest_hash=?3 LIMIT 100`)
    .bind(JSON.stringify(selected.map(e=>e.address)),manifest.source_revision,row.manifest_hash).all<{address:string|null;payload:string|null}>()).results;}
  catch{return held("read_pages_unavailable");}
  if(!loaded.length)return held("source_or_generation_changed");
  const byAddress=new Map(loaded.filter(c=>c.address!==null).map(c=>[c.address!,c.payload]));
  if(byAddress.size!==selected.length)return held("card_missing");
  const cards:((z.infer<typeof Card>)&{discovery_rank:number})[]=[];
  let parsed:z.infer<typeof Card>[];
  try {parsed=selected.map(entry=>Card.parse(JSON.parse(byAddress.get(entry.address)??"null")));}catch{return held("invalid_card");}
  const hashes=await Promise.all(parsed.map(card=>hashJson(card)));
  for(const [i,entry] of selected.entries()){
    const card=parsed[i]!;
    const {card_hash,discovery_rank,...index}=entry;
    if(card.mode!=="live"||card.address!==entry.address||hashes[i]!==card_hash||JSON.stringify(browseEntry(card,new Date(cutoff)))!==JSON.stringify(index))return held("card_integrity_mismatch");
    cards.push({...card,discovery_rank});
  }
  const next=offset+query.limit;
  return {state:"available" as const,semantics:manifest.semantics,action_authority:false as const,manifest_hash:row.manifest_hash,
    data:{candidates:cards,scored_at:manifest.cutoff,mode:"live" as const,sort:query.sort,observed:ranked.observed,counts:ranked.counts,
      scope:{inventory:query.age==="24h"?"active_verified_first_day":"current_evaluation",stored:manifest.entries.length,ranked:ranked.ranked,matched:ranked.matched,available:ranked.rows.length,truncated:ranked.matched>ranked.rows.length,maximum:query.browse==="inventory"?500:100,search_before_limit:true}},
    next_cursor:next<ranked.rows.length?btoa(JSON.stringify({manifest_hash:row.manifest_hash,offset:next,identity})):null};
}
