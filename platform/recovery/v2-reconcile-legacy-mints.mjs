import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {hashJson} from './inventory.mjs';
import {verifyRestoredOriginalMint} from './v2-legacy-mint-source.mjs';
const size=v=>utf8(canonicalJson(v)).length,same=(a,b)=>canonicalJson(a)===canonicalJson(b),clone=v=>JSON.parse(canonicalJson(v));
const need=(yes,reason)=>{if(!yes)throw new TypeError('Recovery legacy mint '+reason);};
const certificateFields=['id','inventory_id','activation_command_id','root_id','source_revision','raw_digest','canonical_digest','origin_digest','source_generation','source_watermark','schema_fingerprint','economic_audit_id','economic_selection_digest','economic_chain_digest','economic_result_json','economic_result_digest','parent_digest','parent_preimage_json','quiescence_json','preparation_digest','preparation_result_json','preparation_result_digest','stage_count','admitted','fulfilled','remaining_json','operator','created_ms'];
const anchorFields=['adoption_id','inventory_id','ordinal','operation_id','stage_id','wallet','request_key','commitment','admitted_ms','settled_ms','terms_digest','price_lamports','cost_lamports','asset_id','body_json','body_digest','source_proof_digest','current_source_digest','prior_chain_digest','chain_digest'];

/** One original settled mint per durable CAS. The mint prefix is private
 * continuation state, separate from the not-yet-verified economic prefix.
 * This helper cannot finish recovery or grant financial execution. */
export function createRecoveryV2LegacyMintReconciler({driver,artifacts,crypto,repository,createDigest,beaconVerifier,onMeasure=(_metrics)=>{},nextPhase=''}){
 return Object.freeze({async step(loaded,c=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json)){
  loaded=clone(loaded);c=parseRecoveryV2Checkpoint(canonicalJson(c));const checkpointWorkingBytes=Math.max(utf8(loaded.run.checkpoint_json).length,size(c));let retained=0,persistent=0;
  const metrics={sql:0,objectReads:0,maxBatchBytes:0,maxReturnedBytes:0,checkpointBytes:utf8(loaded.run.checkpoint_json).length,maxWorkingBytes:0};
  const working=extra=>{const n=checkpointWorkingBytes*3+retained*3+extra+32768;metrics.maxWorkingBytes=Math.max(metrics.maxWorkingBytes,n);need(n<=1048576,'working bound.');};
  const bound=()=>need(metrics.sql+metrics.objectReads+12<=64,'operation bound.');
  const ctx={working,retain(v){retained=size(v)+persistent;working(0);},async read(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(m.batchBytes<=262144,'SQL batch bound.');bound();const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,n);need(n<=262144,'SQL return bound.');working(n*3+m.batchBytes*2);return rows;},async object(identity){metrics.objectReads++;bound();working(identity.size*8);const r=await artifacts.getVerified(identity);need(r?.status==='verified'&&same(r.identity,identity)&&r.bytes instanceof Uint8Array&&r.bytes.length===identity.size,'original artifact missing.');const bytes=r.bytes.slice();need(await crypto.sha256(bytes)===identity.byteDigest,'original artifact digest.');return bytes;}};
  async function pin(){const [rows]=await ctx.read([sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);need(rows.length===1&&rows[0].revision===c.targetWatermark,'target watermark.');}
  try{
   need(same(c,parseRecoveryV2Checkpoint(loaded.run.checkpoint_json)),'checkpoint identity.');
   need(c.phase==='reconcile-legacy-adoption-mints'&&c.legacyAdoption&&size(c.legacyAdoption)<=16384,'phase or context.');
   need(loaded.state.mode==='private'&&loaded.state.status==='restoring'&&loaded.state.active_restore_id===loaded.run.id&&loaded.state.write_nonce===null,'private target.');await pin();
   const state=c.legacyAdoption,columns=certificateFields.join(',');let [certificates,proofs]=await ctx.read([
    sql(`SELECT rowid cursor,${columns} FROM app_collection_legacy_adoptions WHERE id=? AND length(CAST(json_array(${columns}) AS BLOB))<=65536`,state.id),
    sql("SELECT item_count,result_digest FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='legacy-adoption' AND scope=? AND ordinal=0 AND target_watermark=?",loaded.run.id,'certificate:'+state.id,c.targetWatermark)
   ]);
   need(certificates.length===1,'certificate missing.');ctx.retain(certificates[0]);working(size(certificates)*5);const cert=await hashLegacyAdoptionCertificate(certificates[0],crypto),b=cert.body;
   need(cert.certificateDigest===state.certificateDigest&&certificates[0].cursor===state.cursor&&state.stageIndex===b.stageCount&&proofs.length===1&&proofs[0].item_count===1&&proofs[0].result_digest===await hashJson(crypto,['v2-reconciled-legacy-adoption','certificate:'+b.adoptionId,{body:b,digest:cert.certificateDigest}]),'verified certificate prerequisite.');
   certificates=null;proofs=null;ctx.retain({b,state});
   if(!state.mintPrefix){
    const [stages,counts]=await ctx.read([sql('SELECT chain_digest FROM app_collection_legacy_stage_imports WHERE adoption_id=? AND ordinal=?',b.adoptionId,b.stageCount-1),sql("SELECT COUNT(*) n FROM app_collection_legacy_stage_imports i JOIN app_recovery_reconcile_checks p ON p.scope='stage:'||i.adoption_id||':'||i.ordinal WHERE i.adoption_id=? AND p.restore_id=? AND p.phase='legacy-adoption' AND p.ordinal=0 AND p.item_count=1 AND p.target_watermark=?",b.adoptionId,loaded.run.id,c.targetWatermark)]);
    need(counts[0]?.n===b.stageCount&&(b.stageCount===0?state.chain===b.parentDigest:stages.length===1&&stages[0].chain_digest===state.chain),'verified stages prerequisite.');
    const mintPrefix={rootId:b.rootId,ordinal:0,pageIndex:0,entryIndex:0,remaining:[...LEVEL_QUOTAS]};await pin();return await repository.advance(loaded,{delta:{legacyAdoption:{...state,mintPrefix}},targetWatermark:c.targetWatermark});
   }
   const prefix=state.mintPrefix;need(prefix.rootId===b.rootId&&Number.isSafeInteger(prefix.ordinal)&&prefix.ordinal>=0&&prefix.ordinal<=b.admitted&&size(prefix)<=1024,'mint prefix.');
   if(prefix.ordinal===b.admitted){
    const [counts]=await ctx.read([sql("SELECT COUNT(*) n,COALESCE(SUM(CASE WHEN item_count=1 AND ordinal>=0 AND ordinal<? THEN 1 ELSE 0 END),0) valid FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='legacy-adoption-mint' AND scope=? AND target_watermark=?",b.admitted,loaded.run.id,b.adoptionId,c.targetWatermark)]);need(counts[0]?.n===b.admitted&&counts[0].valid===b.admitted&&same(prefix.remaining,b.remaining),'original mint closure.');await pin();return nextPhase?await repository.advance(loaded,{delta:{phase:nextPhase},targetWatermark:c.targetWatermark}):await repository.hold(loaded,'recovery-legacy-adoption-semantics-incomplete');
   }
   const fields=anchorFields.join(','),[anchors]=await ctx.read([sql(`SELECT ${fields} FROM app_collection_legacy_mint_anchors WHERE adoption_id=? AND ordinal=? AND length(CAST(body_json AS BLOB))<=8192`,b.adoptionId,prefix.ordinal)]);
   need(anchors.length===1,'anchor missing.');const row=anchors[0],anchor=JSON.parse(row.body_json),o=anchor.operation,e=anchor.economics;
   need(canonicalJson(anchor)===row.body_json&&await hashJson(crypto,anchor)===row.body_digest&&anchor.format==='legacy-adoption-mint-anchor-v1'&&anchor.adoptionId===b.adoptionId&&anchor.economicAuditId===b.economicAuditId&&anchor.inventoryId===b.inventoryId&&anchor.rootId===b.rootId&&anchor.ordinal===prefix.ordinal&&row.adoption_id===b.adoptionId&&row.inventory_id===b.inventoryId&&row.ordinal===prefix.ordinal&&row.operation_id===o.id&&row.stage_id===o.stageId&&row.wallet===o.wallet&&row.request_key===o.requestKey&&row.commitment===o.commitment&&row.admitted_ms===o.admittedAtMs&&row.settled_ms===o.settledAtMs&&row.terms_digest===e.termsDigest&&row.price_lamports===e.priceLamports&&row.cost_lamports===e.costLamports&&row.asset_id===anchor.originalOutcome.assetId&&row.source_proof_digest===anchor.phaseProofs.advance.proofDigest&&row.current_source_digest===anchor.current.sourceDigest,'anchor identity.');
   need(row.prior_chain_digest===state.chain&&row.chain_digest===await hashJson(crypto,['legacy-adoption-preparation-proof-v1',b.adoptionId,state.chain,'admissions',prefix.ordinal,row.body_digest]),'preparation chain.');
   persistent=size(row)+size(state);ctx.retain({b,state,anchor});const audit=await verifyRestoredOriginalMint({certificate:b,anchor,prefix},{ctx,crypto,createDigest,beaconVerifier});
   const resultDigest=await hashJson(crypto,['v2-legacy-original-mint',b.adoptionId,prefix.ordinal,row.body_digest,anchor.originalOutcome]),delta={legacyAdoption:{...state,mintPrefix:audit.nextPrefix,chain:row.chain_digest}};need(size(delta.legacyAdoption)<=16384,'context bound.');await pin();
   const saved=await repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{phase:'legacy-adoption-mint',scope:b.adoptionId,ordinal:prefix.ordinal,targetWatermark:c.targetWatermark,resultDigest,itemCount:1}});
   return ['progress','replayed'].includes(saved.kind)?{...saved,mintAudit:audit}:saved;
  }catch(error){return await repository.hold(loaded,'recovery-legacy-mint-invalid:'+error.message);}finally{onMeasure({...metrics,operationAllowance:metrics.sql+metrics.objectReads+12});}
 }});
}
