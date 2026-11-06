import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {hashJson} from './inventory.mjs';
import {verifyRetainedLegacyCurrentHistory} from './v2-legacy-current-history.mjs';
const body=fields=>`json_object(${fields.flatMap(k=>["'"+k+"'",k]).join(',')})`;
const transportBody=fields=>`json_object('body',printf('%s',${body(fields)}))`;
const assetFields=['id','inventory_id','owner','bind_ms','observed_ms','reveal_ms','slot','asset'],vaultFields=['id','slot_key','coords','owner','latest_ms'];
const eventFields=['event_id','asset_id','kind','observed_ms','body'],observationFields=['source_id','asset_id','event_kind','observed_ms','digest'],historyFields=['asset_id','effective_ms','level','source_ref'];
const project=(table,fields,where,values,limit,max)=>sql(`SELECT ${body(fields)} body FROM ${table} WHERE ${where} AND length(CAST(${body(fields)} AS BLOB))<=${max} ORDER BY ${fields[0]} LIMIT ${limit}`,...values);
const stats=(table,fields,where,values)=>sql(`SELECT COUNT(*) count,COALESCE(SUM(length(CAST(${body(fields)} AS BLOB))),0) bytes,COALESCE(SUM(length(CAST(${transportBody(fields)} AS BLOB))),0) transportBytes FROM ${table} WHERE ${where}`,...values);
const historyPage=(table,fields,assetId,summary,max)=>project(table,fields,`asset_id=? AND (SELECT COUNT(*) FROM ${table} WHERE asset_id=?)=? AND (SELECT COALESCE(SUM(length(CAST(${body(fields)} AS BLOB))),0) FROM ${table} WHERE asset_id=?)=? AND (SELECT COALESCE(SUM(length(CAST(${transportBody(fields)} AS BLOB))),0) FROM ${table} WHERE asset_id=?)=?`,[assetId,assetId,summary.count,assetId,summary.bytes,assetId,summary.transportBytes],1001,max);
const parsed=rows=>rows.map(r=>JSON.parse(r.body));

const size=v=>utf8(canonicalJson(v)).length,same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery legacy current '+reason);};
/** Private recovery phase. Original-mint semantic proof is mandatory; this
 * first adapter handles unchanged accepted legacy reveal/transfer history.
 * Normalized observation/progression/claim histories explicitly hold until
 * their own accepted-effect replay adapters are integrated. */
export function createRecoveryV2LegacyCurrentReconciler({driver,crypto,repository,onMeasure=(_metrics)=>{},nextPhase='reconcile-legacy-adoption-closure'}){
 return Object.freeze({async step(loaded,c=JSON.parse(loaded.run.checkpoint_json)){
  loaded=JSON.parse(canonicalJson(loaded));c=JSON.parse(canonicalJson(c));
  const metrics={sql:0,maxBatchBytes:0,maxReturnedBytes:0,workingBytes:0},checkpointBytes=utf8(loaded.run.checkpoint_json).length;let retained=0;
  const bound=extra=>{metrics.workingBytes=Math.max(metrics.workingBytes,checkpointBytes*3+retained*3+extra+32768);need(metrics.workingBytes<=1048576,'working bound');};
  async function read(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(metrics.sql<=64,'operation bound');bound(3*m.batchBytes);const result=(await driver.batch(statements)).map(r=>r.rows),n=size(result);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,n);bound(3*(m.batchBytes+n));return result;}
  try{
   const state=c.legacyAdoption,index=state?.currentOrdinal??0;need(c.phase==='reconcile-legacy-adoption-current'&&state&&typeof state.id==='string'&&state.id.length<=128&&Number.isSafeInteger(index)&&index>=0&&index<=1000,'cursor');
   need(loaded.state.mode==='private'&&loaded.state.status==='restoring'&&loaded.state.active_restore_id===loaded.run.id&&loaded.state.write_nonce===null,'target mode');
   const [certs,pins]=await read([sql("SELECT id,inventory_id,root_id,admitted,CASE WHEN length(CAST(parent_preimage_json AS BLOB))<=8192 THEN parent_preimage_json END parent_preimage_json FROM app_collection_legacy_adoptions WHERE id=?",state.id),sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);
   const cert=certs[0];need(certs.length===1&&Number.isSafeInteger(cert.admitted)&&cert.admitted<=1000&&index<=cert.admitted&&typeof cert.parent_preimage_json==='string'&&pins[0]?.revision===c.targetWatermark,'certificate or watermark');
   if(index===cert.admitted)return await repository.advance(loaded,{delta:{phase:nextPhase,legacyAdoption:{...state,currentContext:null}},targetWatermark:c.targetWatermark});
   const [anchors,proofs]=await read([sql('SELECT ordinal,operation_id,asset_id,body_digest,CASE WHEN length(CAST(body_json AS BLOB))<=8192 THEN body_json END body_json FROM app_collection_legacy_mint_anchors WHERE adoption_id=? AND inventory_id=? AND ordinal=?',state.id,cert.inventory_id,index),sql("SELECT item_count,result_digest FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='legacy-adoption-mint' AND scope=? AND ordinal=? AND target_watermark=?",loaded.run.id,state.id,index,c.targetWatermark)]);
   const row=anchors[0];need(anchors.length===1&&typeof row.body_json==='string','anchor');const anchor=JSON.parse(row.body_json);retained=size(cert)+size(row)+size(anchor);bound(0);
   need(await hashJson(crypto,anchor)===row.body_digest&&anchor.adoptionId===state.id&&anchor.inventoryId===cert.inventory_id&&anchor.rootId===cert.root_id&&anchor.ordinal===index&&anchor.operation.id===row.operation_id&&anchor.originalOutcome.assetId===row.asset_id,'anchor binding');
   need(proofs.length===1&&proofs[0].item_count===1&&proofs[0].result_digest===await hashJson(crypto,['v2-legacy-original-mint',state.id,index,row.body_digest,anchor.originalOutcome]),'original mint semantic proof');
   const assetId=row.asset_id,inventoryId=cert.inventory_id;
   const [assets,vaults,ops,headers,entries,vs,os,hs,unsupported]=await read([
    project('collect_assets',assetFields,'id=?',[assetId],1,24576),project('vault_assets',vaultFields,'id=?',[assetId],1,8192),
    project('collect_operations',['id','kind','inventory_id','owner','request_key','request_digest','commitment','created_ms','settled_ms','proof_id','evidence_digest','operation','receipt'],'id=?',[row.operation_id],1,24576),
    sql('SELECT kind,tranche,season_start FROM collect_inventories WHERE id=?',inventoryId),
    sql("SELECT json_extract(a.value,'$.operationId') operationId,json_extract(a.value,'$.ticket') ticket,json_extract(a.value,'$.level') level FROM collect_inventories c,json_each(c.state,'$.admissions') a WHERE c.id=? AND a.key=?",inventoryId,index),
    stats('vault_observations',eventFields,'asset_id=?',[assetId]),stats('collect_observations',observationFields,'asset_id=?',[assetId]),stats('collect_level_history',historyFields,'asset_id=?',[assetId]),
    sql("SELECT (SELECT COUNT(*) FROM app_collection_observation_bindings WHERE asset_id=?) modern,(SELECT COUNT(*) FROM vault_claim_totals WHERE asset_id=?) claims,(SELECT COUNT(*) FROM app_collection_operation_conflicts WHERE asset_id=?) conflicts,(SELECT COUNT(*) FROM collect_operations WHERE inventory_id=? AND (NOT json_valid(operation) OR kind<>'mint' AND (json_extract(CASE WHEN json_valid(operation) THEN operation ELSE '{}' END,'$.targetId')=? OR json_extract(CASE WHEN json_valid(operation) THEN operation ELSE '{}' END,'$.materialId')=?))) progressions",assetId,assetId,assetId,inventoryId,assetId,assetId)]);
   need(assets.length===1&&vaults.length===1&&ops.length===1&&headers.length===1&&entries.length===1,'asset facts');const u=unsupported[0];need(u&&u.claims===0,'claim replay adapter pending');need(u.conflicts===0,'unresolved operation conflict');need(u.progressions===0,'progression replay adapter pending');need(u.modern===0,'modern observation replay adapter pending');
   const asset=parsed(assets)[0],vault=parsed(vaults)[0],operation=parsed(ops)[0],h=headers[0],entry=entries[0],original=anchor.operation;
   need(operation.id===original.id&&operation.kind==='mint'&&operation.inventory_id===inventoryId&&operation.owner===original.wallet&&operation.request_key===original.requestKey&&operation.request_digest===original.requestDigest&&operation.commitment===original.commitment&&operation.created_ms===original.admittedAtMs&&operation.settled_ms===original.settledAtMs&&operation.proof_id===original.proofId&&operation.evidence_digest===original.evidenceDigest&&anchor.originalOutcome.legacyEvidenceDigest===operation.evidence_digest,'original operation binding');
   need(entry.level===anchor.originalOutcome.initialLevel&&same(JSON.parse(asset.slot),anchor.originalOutcome.slot),'original slot and level');
   const summaries=[vs,os,hs].map(r=>r[0]);need(summaries.every(s=>s&&Number.isSafeInteger(s.count)&&s.count>=0&&Number.isSafeInteger(s.bytes)&&s.bytes>=0&&Number.isSafeInteger(s.transportBytes)&&s.transportBytes>=0)&&summaries.reduce((n,s)=>n+s.count,0)<=1000&&summaries.reduce((n,s)=>n+s.bytes,0)<=196608,'history bound');
   retained+=size([asset,vault,operation,h,entry]);bound(3*summaries.reduce((n,s)=>n+s.bytes+s.transportBytes+1024,0));
   const rows=await read([historyPage('vault_observations',eventFields,assetId,summaries[0],8192),historyPage('collect_observations',observationFields,assetId,summaries[1],2048),historyPage('collect_level_history',historyFields,assetId,summaries[2],2048)]),[events,observations,history]=rows.map(parsed);need(rows.every((r,n)=>r.length===summaries[n].count),'history snapshot changed');
   const initialHistory=h.kind==='season'?[{asset_id:assetId,effective_ms:operation.settled_ms,level:entry.level,source_ref:operation.id}]:[],slot=anchor.originalOutcome.slot,vaultObservation={event_id:'collect:'+operation.id,asset_id:assetId,kind:'bind',observed_ms:operation.settled_ms,body:JSON.stringify({eventId:'collect:'+operation.id,assetId,kind:'bind',at:new Date(operation.settled_ms).toISOString(),owner:operation.owner,slot})};
   const input={header:{kind:h.kind,tranche:h.tranche,seasonStart:h.season_start},operation,entry,asset,vault,initialHistory,vaultObservation,events,observations,history,asOfMs:JSON.parse(cert.parent_preimage_json).createdMs};bound(4*size(input)+2*size(rows));
   const result=await verifyRetainedLegacyCurrentHistory(input,crypto);need(result.currentAssetDigest===anchor.current.currentAssetDigest&&same(result.current,anchor.current.current)&&same(result.counts,anchor.current.counts),'accepted historical current commitment');
   const digest=await hashJson(crypto,['v2-legacy-current',state.id,index,row.body_digest,{currentAssetDigest:result.currentAssetDigest,current:result.current,counts:result.counts}]);
   return await repository.advance(loaded,{delta:{legacyAdoption:{...state,currentOrdinal:index+1,currentContext:null}},targetWatermark:c.targetWatermark,check:{phase:'legacy-adoption-current',scope:state.id,ordinal:index,targetWatermark:c.targetWatermark,resultDigest:digest,itemCount:1}});
  }catch(error){return await repository.hold(loaded,'recovery-legacy-current-invalid:'+error.message);}finally{onMeasure({...metrics});}
 }});
}
