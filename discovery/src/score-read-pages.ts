import {z} from "zod";
import {Address,DEFAULT_POLICY} from "./model";
import {CandidateCardSchema,candidateCard} from "./candidate-card";
import {ScoreSummaryV4Schema,DISCOVERY_SCORE_POLICY_V4} from "./discovery-score-v4-model";
import {rankedDiscovery,scoreInventoryCandidates} from "./discovery-score-store";
import {browseEntries,browseEntry} from "./discovery-browse-order";
import {hashJson} from "./solana";
import {control} from "./store";
import {storedJsonHash} from "./stored-json-hash";

// Bump on evaluator/browse semantics changes, even if numeric policies do not change.
const VERSION="discovery-score-read-pages-v2" as const,WINDOW_MS=60000,PAGE_SIZE=25;
const Hash=z.string().regex(/^[a-f0-9]{64}$/),Eligibility=z.enum(["eligible","provisional","excluded"]);
const Card=CandidateCardSchema.omit({discovery_rank:true}).extend({discovery_score:ScoreSummaryV4Schema});
const Body=Card.omit({discovery_score:true});
const SummaryPage=z.object({address:Address,discovery_score:ScoreSummaryV4Schema}).strict().array().min(1).max(PAGE_SIZE);
const Entry=z.object({address:Address,name:z.string().max(100),symbol:z.string().max(32),eligibility:Eligibility,creation_at:z.iso.datetime().nullable(),
  score:z.number().finite().min(0).max(100),coverage:z.number().finite().min(0).max(100),liquidity:z.number().finite().nonnegative().nullable(),freshness:z.enum(["fresh","stale","missing"]),card_hash:Hash,body_hash:Hash,score_page:z.number().int().min(0).max(19)}).strict();
const Manifest=z.object({version:z.literal(VERSION),policy_hash:Hash,source_revision:z.number().int().safe().nonnegative(),cutoff:z.iso.datetime(),expires_at:z.iso.datetime(),
  scope:z.literal("current_evaluation"),semantics:z.literal("frozen_at_cutoff"),action_authority:z.literal(false),entries:Entry.array().max(500),summary_pages:z.object({page:z.number().int().min(0).max(19),hash:Hash}).strict().array().max(20)}).strict();
const Query=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),status:z.enum(["all","eligible","provisional","excluded"]).default("all"),age:z.enum(["all","24h"]).default("all"),
  sort:z.enum(["score","liquidity"]).default("score"),browse:z.enum(["top100","inventory"]).default("top100"),q:z.string().trim().max(100).default(""),
  freshness:z.enum(["all","fresh","stale","missing"]).default("all"),min_liquidity:z.coerce.number().finite().min(0).max(1e12).default(0),min_coverage:z.coerce.number().finite().min(0).max(100).default(0),cursor:z.string().max(512).optional()}).strict();
const Cursor=z.object({manifest_hash:Hash,offset:z.number().int().min(0).max(500),identity:Hash}).strict();
const policyIdentity=()=>({contract:VERSION,score:DISCOVERY_SCORE_POLICY_V4,actions:DEFAULT_POLICY});
const policyHash=()=>hashJson(policyIdentity());
const held=(reason:string)=>({state:"held" as const,reason,action_authority:false as const});
const bytes=(s:string)=>new TextEncoder().encode(s).byteLength;

export async function buildScoreReadPages(db:D1Database,at=new Date()) {
  if((await control(db)).paused)return held("paused");
  let revision:number|null;
  try {revision=await db.prepare("SELECT revision FROM tenx_score_source_revision WHERE id=1").first<number>("revision");
    // Do not begin expensive evaluation if the new migration is unavailable.
    await db.prepare("SELECT id FROM tenx_score_page_manifest WHERE id=1").first();
    await db.prepare("SELECT body_hash FROM tenx_score_page_cards LIMIT 1").first();
    await db.prepare("SELECT page FROM tenx_score_page_summaries LIMIT 1").first();
  }catch{return held("read_pages_unavailable");}
  if(revision===null)return held("source_revision_missing");
  const source=await scoreInventoryCandidates(db,"live",false),ranked=await rankedDiscovery(db,source,at,"score","all",{maximum:500});
  // All summaries change with the cutoff anyway. Group by the default browse
  // rank so its first page does not load unrelated score-summary pages.
  const cards=ranked.rows.map(row=>{const {discovery_rank:ignored,...card}=candidateCard(row);return Card.parse(card);});
  const payloads=cards.map(card=>JSON.stringify(card));
  if(payloads.some(p=>bytes(p)>16000)||payloads.reduce((n,p)=>n+bytes(p),0)>1800000)return held("card_size_limit");
  const bodies=cards.map(({discovery_score:ignored,...body})=>Body.parse(body));
  const entries=await Promise.all(cards.map(async(card,i)=>({...browseEntry(card,at),card_hash:await hashJson(card),body_hash:await hashJson(bodies[i]),score_page:Math.floor(i/PAGE_SIZE)})));
  const pages=[];
  for(let offset=0;offset<cards.length;offset+=PAGE_SIZE){
    const summaries=SummaryPage.parse(cards.slice(offset,offset+PAGE_SIZE).map(c=>({address:c.address,discovery_score:c.discovery_score})));
    const payload=JSON.stringify(summaries);if(bytes(payload)>100000)return held("summary_page_size_limit");
    pages.push({page:Math.floor(offset/PAGE_SIZE),hash:await hashJson(summaries),payload});
  }
  const manifest=Manifest.parse({version:VERSION,policy_hash:await policyHash(),source_revision:revision,cutoff:at.toISOString(),expires_at:new Date(at.getTime()+WINDOW_MS).toISOString(),
    scope:"current_evaluation",semantics:"frozen_at_cutoff",action_authority:false,entries,summary_pages:pages.map(({page,hash})=>({page,hash}))});
  const payload=JSON.stringify(manifest);if(bytes(payload)>600000)return held("manifest_size_limit");
  const hash=await hashJson(manifest),input=JSON.stringify(bodies.map((c,i)=>({address:c.address,payload:JSON.stringify(c),body_hash:entries[i]!.body_hash}))),pageInput=JSON.stringify(pages);
  if(bytes(input)>1800000||bytes(pageInput)>1800000)return held("card_batch_size_limit");
  // D1 batch is one transaction. Every statement uses the same admission;
  // a rejected builder leaves the previous complete generation untouched.
  const guard=`EXISTS(SELECT 1 FROM tenx_score_source_revision WHERE id=1 AND revision=?1)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)
    AND NOT EXISTS(SELECT 1 FROM tenx_score_page_manifest WHERE cutoff>?2)`;
  const result=await db.batch([
    db.prepare(`DELETE FROM tenx_score_page_cards WHERE address NOT IN (SELECT json_extract(value,'$.address') FROM json_each(?3)) AND ${guard}`).bind(revision,manifest.cutoff,input),
    db.prepare(`INSERT INTO tenx_score_page_cards(address,manifest_hash,payload,body_hash)
      SELECT json_extract(value,'$.address'),?3,json_extract(value,'$.payload'),json_extract(value,'$.body_hash') FROM json_each(?4) WHERE ${guard}
      ON CONFLICT(address) DO UPDATE SET manifest_hash=excluded.manifest_hash,payload=excluded.payload,body_hash=excluded.body_hash
      WHERE tenx_score_page_cards.payload<>excluded.payload OR tenx_score_page_cards.body_hash<>excluded.body_hash`).bind(revision,manifest.cutoff,hash,input),
    db.prepare(`DELETE FROM tenx_score_page_summaries WHERE page NOT IN (SELECT json_extract(value,'$.page') FROM json_each(?3)) AND ${guard}`).bind(revision,manifest.cutoff,pageInput),
    db.prepare(`INSERT INTO tenx_score_page_summaries(page,payload)
      SELECT json_extract(value,'$.page'),json_extract(value,'$.payload') FROM json_each(?3) WHERE ${guard}
      ON CONFLICT(page) DO UPDATE SET payload=excluded.payload WHERE tenx_score_page_summaries.payload<>excluded.payload`).bind(revision,manifest.cutoff,pageInput),
    db.prepare(`INSERT INTO tenx_score_page_manifest(id,source_revision,cutoff,manifest_hash,payload)
      SELECT 1,?1,?2,?3,?4 WHERE ${guard}
      ON CONFLICT(id) DO UPDATE SET source_revision=excluded.source_revision,cutoff=excluded.cutoff,manifest_hash=excluded.manifest_hash,payload=excluded.payload
      WHERE tenx_score_page_manifest.manifest_hash<>excluded.manifest_hash OR tenx_score_page_manifest.payload<>excluded.payload OR tenx_score_page_manifest.source_revision<>excluded.source_revision OR tenx_score_page_manifest.cutoff<>excluded.cutoff`).bind(revision,manifest.cutoff,hash,payload),
    db.prepare(`SELECT 1 AS published FROM tenx_score_page_manifest WHERE id=1 AND manifest_hash=?3 AND ${guard}`).bind(revision,manifest.cutoff,hash),
  ]);
  if(result[5]!.results.length!==1)return held("source_changed_paused_or_newer_snapshot");
  return {state:"built" as const,manifest_hash:hash,cutoff:manifest.cutoff,candidates:cards.length,manifest_bytes:bytes(payload),card_bytes:payloads.reduce((n,p)=>n+bytes(p),0),
    writes:{removed_bodies:result[0]!.meta.changes,changed_bodies:result[1]!.meta.changes,removed_summary_pages:result[2]!.meta.changes,changed_summary_pages:result[3]!.meta.changes,manifest:result[4]!.meta.changes},action_authority:false as const};
}

export async function readScoreReadPages(db:D1Database,raw:unknown={},now=new Date()) {
  const query=Query.parse(raw),{cursor:ignored,limit:ignoredLimit,...filters}=query,identity=storedJsonHash(filters);
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
  if(manifest.source_revision!==row.source_revision||manifest.cutoff!==row.cutoff||storedJsonHash(manifest)!==row.manifest_hash)return held("manifest_integrity_mismatch");
  if(manifest.policy_hash!==storedJsonHash(policyIdentity()))return held("policy_changed");
  const cutoff=Date.parse(manifest.cutoff),time=now.getTime();
  if(!Number.isFinite(time)||Date.parse(manifest.expires_at)!==cutoff+WINDOW_MS||time<cutoff||time>=cutoff+WINDOW_MS)return held("cutoff_expired_or_future");
  if(cursor&&cursor.manifest_hash!==row.manifest_hash)return held("cursor_refresh_required");
  if(new Set(manifest.entries.map(e=>e.address)).size!==manifest.entries.length)return held("inventory_mismatch");
  const pageOrder=browseEntries(manifest.entries,"score","all",{maximum:500}).rows;
  if(manifest.summary_pages.length!==Math.ceil(pageOrder.length/PAGE_SIZE)||manifest.summary_pages.some((p,i)=>p.page!==i)||pageOrder.some((e,i)=>e.score_page!==Math.floor(i/PAGE_SIZE)||e.address!==manifest.entries[i]?.address))return held("summary_inventory_mismatch");
  const population=query.age==="all"?manifest.entries:manifest.entries.filter(e=>e.creation_at!==null&&cutoff-Date.parse(e.creation_at)>=0&&cutoff-Date.parse(e.creation_at)<=86400000);
  const ranked=browseEntries(population,query.sort,query.status,{search:query.q,freshness:query.freshness,min_liquidity:query.min_liquidity,min_coverage:query.min_coverage,maximum:query.browse==="inventory"?500:100});
  const offset=cursor?.offset??0;if(offset>ranked.rows.length)return held("cursor_refresh_required");
  const selected=ranked.rows.slice(offset,offset+query.limit);
  // Recheck the generation and source revision in the card lookup itself. Even
  // empty results must observe this barrier, so concurrent changes never pass.
  let loaded:{address:string|null;payload:string|null}[];
  let scoreRows:{page:number|null;payload:string|null}[];
  try {const results=await db.batch([db.prepare(`SELECT c.address,CASE WHEN length(CAST(c.payload AS BLOB))<=16000 THEN c.payload ELSE NULL END AS payload
    FROM tenx_score_source_revision r JOIN tenx_score_page_manifest m ON m.id=r.id
    LEFT JOIN json_each(?1) wanted ON true LEFT JOIN tenx_score_page_cards c ON c.address=json_extract(wanted.value,'$.address') AND c.body_hash=json_extract(wanted.value,'$.body_hash')
    WHERE r.id=1 AND r.revision=?2 AND m.source_revision=r.revision AND m.manifest_hash=?3 LIMIT 100`)
    .bind(JSON.stringify(selected.map(e=>({address:e.address,body_hash:e.body_hash}))),manifest.source_revision,row.manifest_hash),
    db.prepare(`SELECT s.page,CASE WHEN length(CAST(s.payload AS BLOB))<=100000 THEN s.payload ELSE NULL END AS payload
      FROM tenx_score_source_revision r JOIN tenx_score_page_manifest m ON m.id=r.id
      LEFT JOIN json_each(?1) wanted ON true LEFT JOIN tenx_score_page_summaries s ON s.page=wanted.value
      WHERE r.id=1 AND r.revision=?2 AND m.source_revision=r.revision AND m.manifest_hash=?3 LIMIT 20`)
      .bind(JSON.stringify([...new Set(selected.map(e=>e.score_page))]),manifest.source_revision,row.manifest_hash)]);
    loaded=results[0]!.results as typeof loaded;scoreRows=results[1]!.results as typeof scoreRows;}
  catch{return held("read_pages_unavailable");}
  if(!loaded.length||!scoreRows.length)return held("source_or_generation_changed");
  const byAddress=new Map(loaded.filter(c=>c.address!==null).map(c=>[c.address!,c.payload]));
  if(byAddress.size!==selected.length)return held("card_missing");
  const wantedPages=new Set(selected.map(e=>e.score_page)),summaries=new Map<string,z.infer<typeof ScoreSummaryV4Schema>>();
  if(scoreRows.filter(s=>s.page!==null).length!==wantedPages.size)return held("summary_page_missing");
  for(const row of scoreRows){if(row.page===null)continue;
    let page:z.infer<typeof SummaryPage>;try {page=SummaryPage.parse(JSON.parse(row.payload??"null"));}catch{return held("invalid_summary_page");}
    const expected=pageOrder.filter(e=>e.score_page===row.page);
    if(!wantedPages.has(row.page)||storedJsonHash(page)!==manifest.summary_pages[row.page]?.hash||JSON.stringify(page.map(s=>s.address))!==JSON.stringify(expected.map(e=>e.address))||page.some(s=>s.discovery_score.as_of!==manifest.cutoff))return held("summary_page_integrity_mismatch");
    for(const summary of page)summaries.set(summary.address,summary.discovery_score);
  }
  const cards:((z.infer<typeof Card>)&{discovery_rank:number})[]=[];
  let parsed:z.infer<typeof Card>[];
  let bodies:z.infer<typeof Body>[];
  try {bodies=selected.map(entry=>Body.parse(JSON.parse(byAddress.get(entry.address)??"null")));
    // Card is the strict Body shape plus the strict score shape. Both have
    // already been fully parsed; do not revalidate every field a second time.
    // Restore whole-object parsing if Card gains cross-field refinements.
    parsed=bodies.map(body=>{const discovery_score=summaries.get(body.address);if(!discovery_score)throw Error("missing_summary");return {...body,discovery_score};});}catch{return held("invalid_card");}
  const hashes=parsed.map(storedJsonHash),bodyHashes=bodies.map(storedJsonHash);
  for(const [i,entry] of selected.entries()){
    const card=parsed[i]!;
    const {card_hash,body_hash,score_page:ignoredPage,discovery_rank,...index}=entry;
    if(card.mode!=="live"||card.address!==entry.address||hashes[i]!==card_hash||bodyHashes[i]!==body_hash||JSON.stringify(browseEntry(card,new Date(cutoff)))!==JSON.stringify(index))return held("card_integrity_mismatch");
    cards.push({...card,discovery_rank});
  }
  const next=offset+query.limit;
  return {state:"available" as const,semantics:manifest.semantics,action_authority:false as const,manifest_hash:row.manifest_hash,
    data:{candidates:cards,scored_at:manifest.cutoff,mode:"live" as const,sort:query.sort,observed:ranked.observed,counts:ranked.counts,
      scope:{inventory:query.age==="24h"?"active_verified_first_day":"current_evaluation",stored:manifest.entries.length,ranked:ranked.ranked,matched:ranked.matched,available:ranked.rows.length,truncated:ranked.matched>ranked.rows.length,maximum:query.browse==="inventory"?500:100,search_before_limit:true}},
    next_cursor:next<ranked.rows.length?btoa(JSON.stringify({manifest_hash:row.manifest_hash,offset:next,identity})):null};
}
