import { MintReviewRequest, MintReviewsResponse, MINT_REVIEW_LIMITS as limits } from "./mint-review-model";
import { curveAddress, migrations, WSOL } from "./pump";
import { RpcClient, SignatureRows, SourceError, TransactionSchema, type Transaction } from "./rpc";
import { hashJson } from "./solana";

export class MintReviewError extends Error { constructor(message:string,readonly status=409){super(message);} }
type Review = {address:string;curve:string;state:string;queued_at:string;updated_at:string;pages:number;before_signature:string|null;page_full:number;pending:string};
const active="state IN ('queued','scanning')";
const owned="EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2 AND paused=0)";

export async function enqueueMintReview(db:D1Database,raw:unknown,now=new Date()) {
  const input=MintReviewRequest.parse(raw),at=now.toISOString(),id=crypto.randomUUID(),curve=await curveAddress(input.address);
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_mint_reviews(address,request_id,curve,state,queued_at,updated_at)
      SELECT ?1,?2,?3,'queued',?4,?4 WHERE (SELECT count(*) FROM tenx_mint_reviews WHERE ${active})<?5 AND (SELECT count(*) FROM tenx_mint_reviews)<?6`)
      .bind(input.address,id,curve,at,limits.active,limits.retained),
    db.prepare(`INSERT INTO tenx_audit(id,action,actor,reason,data_hash,created_at)
      SELECT ?1,'mint_review_queued','local-operator',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM tenx_mint_reviews WHERE address=?5 AND request_id=?1)`)
      .bind(id,input.reason,await hashJson({address:input.address,curve}),at,input.address),
  ]);
  const saved=await db.prepare("SELECT request_id,state FROM tenx_mint_reviews WHERE address=?1").bind(input.address).first<{request_id:string;state:string}>();
  if(!saved)throw new MintReviewError("mint_review_queue_full",429);
  return {address:input.address,state:saved.state,duplicate:saved.request_id!==id,provider_requests:0,evidence_gates_changed:false};
}

export async function mintReviews(db:D1Database,now=new Date()) {
  const rows=await db.prepare(`SELECT r.address,r.curve,r.state,r.queued_at,r.updated_at,r.pages,r.migration_signature,r.quote,r.last_error,
    (SELECT count(*) FROM tenx_mint_review_reads b WHERE b.address=r.address) AS bodies_checked,
    EXISTS(SELECT 1 FROM tenx_candidates c WHERE c.mode='live' AND c.address=r.address) AS candidate_present
    FROM tenx_mint_reviews r ORDER BY CASE WHEN r.state IN ('queued','scanning') THEN 0 ELSE 1 END,r.updated_at DESC,r.address LIMIT 100`).all();
  const used=await db.prepare("SELECT used FROM tenx_usage WHERE provider='mint_intake' AND day=?1").bind(now.toISOString().slice(0,10)).first<{used:number}>();
  return MintReviewsResponse.shape.data.parse({at:now.toISOString(),reviews:rows.results.map(r=>({...r,candidate_present:Boolean(r.candidate_present)})),limits,reserved_today:used?.used??0,provider_requests:0,evidence_gates_changed:false});
}

// Called only inside the ordinary discovery lease, after its shared pacing,
// backoff, mainnet check and contender reservations. No independent scheduler.
export async function advanceMintReview(db:D1Database,rpc:RpcClient,job:string,clock:()=>Date):Promise<number> {
  let row=await db.prepare(`SELECT * FROM tenx_mint_reviews WHERE ${active} ORDER BY updated_at,address LIMIT 1`).first<Review>();
  if(!row)return 0;
  const address=row.address;
  const assertOwner=async()=>{if(!await db.prepare(`SELECT 1 WHERE ${owned}`).bind(job,clock().toISOString()).first())throw new SourceError("discovery_lease_lost");};
  const patch=async(state:string,error:string|null=null,signature:string|null=null,quote:string|null=null)=>{
    await db.prepare(`UPDATE tenx_mint_reviews SET state=?3,last_error=?4,migration_signature=COALESCE(?5,migration_signature),quote=COALESCE(?6,quote),updated_at=?2
      WHERE address=?7 AND ${active} AND ${owned}`).bind(job,clock().toISOString(),state,error,signature,quote,address).run();
  };
  const reserve=async()=>{
    await assertOwner();
    const saved=await db.prepare(`INSERT INTO tenx_usage(provider,day,used) SELECT 'mint_intake',?3,1 WHERE ${owned}
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1 WHERE used<?4 AND ${owned} RETURNING used`)
      .bind(job,clock().toISOString(),clock().toISOString().slice(0,10),limits.rpc_daily_subset).first();
    if(!saved){await assertOwner();throw new MintReviewError("mint_intake_daily_limit");}
  };
  await assertOwner();
  if(Date.parse(row.queued_at)+86400000<=clock().getTime()){await patch("expired","mint_review_window_expired");return 0;}
  const existing=await db.prepare("SELECT migration_signature,migration_tx FROM tenx_leads WHERE address=?1").bind(address).first<{migration_signature:string;migration_tx:string}>();
  if(existing){
    const tx=TransactionSchema.parse(JSON.parse(existing.migration_tx));
    const match=(await migrations(tx)).find(m=>m.address===address);
    if(match&&tx.transaction.signatures[0]===existing.migration_signature&&match.quote===WSOL){await patch("admitted",null,existing.migration_signature,match.quote);return 0;}
  }
  let bodies=0;
  try {
    let pending=SignatureRows.parse(JSON.parse(row.pending));
    if(!pending.length){
      if(!row.page_full||row.pages>=limits.pages){await patch("not_found","migration_not_found_within_bound");return 0;}
      await reserve();
      const page=await rpc.signatures(row.curve,limits.page_size,row.before_signature??undefined);
      await assertOwner();
      const seen=await db.prepare("SELECT signature FROM tenx_mint_review_reads WHERE address=?1").bind(address).all<{signature:string}>();
      const prior=new Set(seen.results.map(r=>r.signature));
      if(page.length>limits.page_size||new Set(page.map(r=>r.signature)).size!==page.length||page.some((r,i)=>r.signature===row!.before_signature||prior.has(r.signature)||(i>0&&r.slot>page[i-1]!.slot)||r.blockTime!==null&&r.blockTime*1000>clock().getTime()))throw new SourceError("mint_review_page_invalid");
      pending=page.filter(r=>r.err===null&&r.confirmationStatus==="finalized");
      const payload=JSON.stringify(page),at=clock().toISOString();
      await db.batch([
        db.prepare(`INSERT INTO tenx_mint_review_pages(address,page,payload,payload_hash,observed_at)
          SELECT ?3,?4,?5,?6,?2 WHERE ${owned}`)
          .bind(job,at,address,row.pages+1,payload,await hashJson(page)),
        db.prepare(`UPDATE tenx_mint_reviews SET pages=pages+1,before_signature=?3,page_full=?4,pending=?5,state='scanning',last_error=NULL,updated_at=?2 WHERE address=?6 AND ${active} AND ${owned}`)
          .bind(job,at,page.at(-1)?.signature??row.before_signature,page.length===limits.page_size?1:0,JSON.stringify(pending),address),
      ]);
      await assertOwner();
      row={...row,pages:row.pages+1,page_full:page.length===limits.page_size?1:0};
    }
    for(const item of pending.slice(0,limits.bodies_per_turn)){
      await assertOwner();
      const cached=await db.prepare("SELECT payload,payload_hash FROM tenx_evidence WHERE signature=?1").bind(item.signature).first<{payload:string;payload_hash:string}>();
      let tx:Transaction|null=null,outcome="not_target_migration";
      if(cached){tx=TransactionSchema.parse(JSON.parse(cached.payload));if(await hashJson(tx)!==cached.payload_hash)throw new SourceError("mint_review_cached_hash_mismatch");}
      else {
        await reserve();
        try{tx=await rpc.transaction(item.signature);}
        catch(error){if(error instanceof SourceError&&["unsupported_transaction_version","transaction_layout_unsupported"].includes(error.code))outcome=error.code;else throw error;}
      }
      bodies++;
      await assertOwner();
      let match;
      if(tx){
        if(tx.transaction.signatures[0]!==item.signature||tx.slot!==item.slot||tx.blockTime===null||tx.blockTime*1000>clock().getTime())throw new SourceError("mint_review_transaction_identity_or_time_mismatch");
        try{match=(await migrations(tx)).find(m=>m.address===address);}
        catch{outcome="unsupported_or_invalid_transaction";}
      }else if(outcome==="not_target_migration")outcome="archival_body_missing";
      if(match)outcome=match.quote!==WSOL?"unsupported_quote":tx!.blockTime!*1000<clock().getTime()-86400000?"migration_outside_window":"migration_verified";
      const at=clock().toISOString(),hash=tx?await hashJson(tx):null;
      const statements=[
        db.prepare(`INSERT INTO tenx_mint_review_reads(address,signature,slot,outcome,payload_hash,observed_at) SELECT ?3,?4,?5,?6,?7,?2 WHERE ${owned}`)
          .bind(job,at,address,item.signature,item.slot,outcome,hash),
      ];
      if(match&&tx){
        statements.push(db.prepare(`INSERT OR IGNORE INTO tenx_evidence(signature,payload_hash,payload,fetched_at) SELECT ?3,?4,?5,?2 WHERE ${owned}`).bind(job,at,item.signature,hash,JSON.stringify(tx)));
        if(outcome==="migration_verified")statements.push(db.prepare(`INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at)
          SELECT ?3,?4,?5,?6,?2 WHERE ${owned} ON CONFLICT(address) DO NOTHING`).bind(job,at,address,match.pool,JSON.stringify(tx),item.signature));
      }
      pending=pending.slice(1);
      const state=outcome==="migration_verified"?"admitted":outcome==="unsupported_quote"?"unsupported_quote":outcome==="migration_outside_window"?"expired":!pending.length&&(!row.page_full||row.pages>=limits.pages)?"not_found":"scanning";
      statements.push(db.prepare(`UPDATE tenx_mint_reviews SET state=?3,pending=?4,migration_signature=COALESCE(?5,migration_signature),quote=COALESCE(?6,quote),last_error=?7,updated_at=?2 WHERE address=?8 AND ${active} AND ${owned}`)
        .bind(job,at,state,JSON.stringify(pending),match?item.signature:null,match?.quote??null,state==="scanning"||state==="admitted"?null:outcome==="not_target_migration"?"migration_not_found_within_bound":outcome,address));
      await db.batch(statements);
      await assertOwner();
      if(state!=="scanning")return bodies;
    }
    if(!pending.length&&(!row.page_full||row.pages>=limits.pages))await patch("not_found","migration_not_found_within_bound");
    return bodies;
  }catch(error){
    const code=error instanceof SourceError||error instanceof MintReviewError?error.message:"mint_review_data_invalid";
    await patch("scanning",code);
    if(error instanceof MintReviewError)return bodies;
    throw error;
  }
}
