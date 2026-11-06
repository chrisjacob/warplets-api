import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {legacySealedListSql,verifyLegacySealedLists,legacyIndexedPagesSql,verifyLegacyIndexedPage} from '../collect/legacy-stage-source.mjs';
const size=v=>utf8(canonicalJson(v)).length,same=(a,b)=>canonicalJson(a)===canonicalJson(b),clone=v=>JSON.parse(canonicalJson(v));
const need=(yes,reason)=>{if(!yes)throw new TypeError('economic-stage-'+reason);};
const pinSql='SELECT r.generation,r.mode,r.status,r.write_nonce,r.active_restore_id,w.revision watermark FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1';
/** Reconstructs a previously completed stage proof under the same target pin.
 * This avoids repeating the original full-wallet-list audit for every mint.
 * The durable proof must match every reconstructed semantic result field. */
export function createRecoveryLegacyEconomicStageReader({driver,crypto,artifacts}){
 return Object.freeze({async read(value){
  const q=clone(value),metrics={sql:0,objects:0,maxBatchBytes:0,workingBytes:0};let retained=0;
  const hash=v=>crypto.sha256(utf8(canonicalJson(v)));
  const bound=extra=>{metrics.workingBytes=Math.max(metrics.workingBytes,(q.retainedBytes??0)+3*size(q)+retained+extra+32768);need(metrics.workingBytes<=1048576,'working-bound');};
  const pin=rows=>need(rows.length===1&&rows[0].generation===q.pin.generation&&rows[0].watermark===q.pin.watermark&&rows[0].mode==='private'&&rows[0].status==='restoring'&&rows[0].write_nonce===null&&rows[0].active_restore_id===q.restoreId,'target-changed');
  async function read(statements){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(metrics.sql+metrics.objects<=64&&m.batchBytes<=262144,'operation-bound');bound(m.batchBytes*3);const rows=(await driver.batch(statements)).map(r=>r.rows);bound((m.batchBytes+size(rows))*3);return rows;}
  try{
   need(size(q)<=16384&&Number.isSafeInteger(q.retainedBytes??0)&&(q.retainedBytes??0)>=0,'input');const a=q.anchor,c=q.certificate;need(a.adoptionId===c.adoptionId&&a.inventoryId===c.inventoryId&&a.rootId===c.rootId,'anchor');
   const [pins,rows]=await read([sql(pinSql),sql('SELECT ordinal,stage_id,body_json,body_digest,source_proof_digest,chain_digest FROM app_collection_legacy_stage_imports WHERE adoption_id=? AND stage_id=? AND length(CAST(body_json AS BLOB))<=16384',c.adoptionId,a.operation.stageId)]);pin(pins);need(rows.length===1,'stage-missing');const r=rows[0],body=JSON.parse(r.body_json);retained=size(rows)*3+size(body)*3;bound(0);
   need(canonicalJson(body)===r.body_json&&await hash(body)===r.body_digest&&body.adoptionId===c.adoptionId&&body.inventoryId===c.inventoryId&&body.rootId===c.rootId&&body.stageIndex===r.ordinal&&body.stage.stageId===r.stage_id&&body.stageProofDigest===r.source_proof_digest&&r.source_proof_digest===a.stageProofDigest,'stage-binding');
   const identity=privateIdentity(body.originalIdentity);need(same(identity,body.originalIdentity)&&identity.size>0&&identity.size<=16384&&identity.contentType==='application/json'&&identity.semanticDigest===null,'original-identity');
   const [proofs,objects]=await read([sql("SELECT result_digest,item_count FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='legacy-adoption' AND scope=? AND ordinal=0 AND target_watermark=?",q.restoreId,'stage:'+c.adoptionId+':'+r.ordinal,q.pin.watermark),sql('SELECT identity_json,body_json,body_digest FROM app_collection_legacy_adoption_objects WHERE adoption_id=? AND object_key=? AND length(CAST(body_json AS BLOB))<=8192',c.adoptionId,identity.key)]);need(proofs.length===1&&proofs[0].item_count===1&&objects.length===1&&objects[0].identity_json===canonicalJson(identity),'completion-or-object-proof');
   const objectProof={format:'legacy-adoption-object-proof-v1',adoptionId:c.adoptionId,identity,descriptorChildren:[]};need(objects[0].body_json===canonicalJson(objectProof)&&objects[0].body_digest===await hash(objectProof),'object-proof');metrics.objects++;bound(identity.size*7);const artifact=await artifacts.getVerified(identity);need(artifact.status==='verified'&&artifact.bytes.length===identity.size&&await crypto.sha256(artifact.bytes)===identity.byteDigest,'original-bytes');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(artifact.bytes),original=JSON.parse(text);need(canonicalJson(original)===text&&original.format==='legacy-stage-publication-preimage-v1'&&original.inventoryId===c.inventoryId&&original.stageId===r.stage_id,'original-binding');const terms=JSON.parse(body.stage.termsJson);
   const listIds=[...new Set([original.walletListId,...(body.stage.eligibilityKind==='list'?[body.stage.listId]:[])])],[lists]=await read([legacySealedListSql(listIds)]),verified=await verifyLegacySealedLists(lists,listIds,crypto),originalList=verified.seals.find(s=>s.id===original.walletListId);need(originalList,'original-list');retained+=identity.size*7+size(verified)*3;bound(size(lists)*3);
   const summary={kind:'verified',inventoryId:c.inventoryId,stageId:r.stage_id,termsDigest:terms.termsDigest,originalHeaderDigest:identity.byteDigest,originalListId:originalList.id,walletsDigest:originalList.walletsDigest,walletCount:originalList.count,normalizedProjectionDigest:await hash(terms),membership:original.type==='free'?'separate-free-cut-audit-required':original.type==='public'?'unrestricted':'exact-original-list',verification:'publication-preimage-and-scalar-reducer-only',source:'local-reference-fixture',executable:false};
   const previous={adoptionId:c.adoptionId,stageIndex:r.ordinal,stageId:r.stage_id,bodyDigest:r.body_digest,stageProofDigest:r.source_proof_digest,sourceDigest:body.stageSourceDigest,chainDigest:r.chain_digest,originalIdentity:identity,summary};need(await hash(['v2-reconciled-legacy-adoption','stage:'+c.adoptionId+':'+r.ordinal,previous])===proofs[0].result_digest,'completed-stage-digest');
   let membership=null;
   if(original.type==='public')need(body.stage.eligibilityKind==='unrestricted'&&a.membership.listId===null,'public-membership');
   else{
    need(original.type!=='free','original-free-cut-prerequisite');const seal=verified.seals.find(s=>s.id===body.stage.listId);need(seal&&seal.id===originalList.id&&a.membership.listId===seal.id&&a.membership.walletsDigest===seal.walletsDigest,'membership-list');
    const [locations]=await read([sql('SELECT p.record_id id,CAST(ids.key AS INTEGER) page_index FROM json_each(?) ids JOIN app_collection_eligibility_pages p ON p.record_id=ids.value WHERE EXISTS(SELECT 1 FROM json_each(p.entries_json) e WHERE e.value=?) LIMIT 2',canonicalJson(seal.pageIds),a.operation.wallet)]);need(locations.length===1,'member-location');const location=locations[0];need(seal.pageIds[location.page_index]===location.id&&a.membership.pageId===location.id,'member-index');
    const [pages]=await read([legacyIndexedPagesSql([location.id])]);need(pages.length===1,'member-page');const entries=await verifyLegacyIndexedPage(pages[0],{id:location.id,index:location.page_index,count:Math.min(100,seal.count-location.page_index*100),ordinal:0},crypto);need(entries.includes(a.operation.wallet),'member-wallet');const bytes=utf8(canonicalJson({format:'collection-page-v1',kind:'eligibility',index:location.page_index,entries}));membership={seal,page:{id:location.id,size:bytes.length,bytes}};bound(size(pages)*3+bytes.length*5);
   }
   const [after]=await read([sql(pinSql)]);pin(after);return {kind:'verified',stageAudit:summary,membership,verification:'completed-stage-proof-and-original-membership',readiness:false,metrics};
  }catch(error){return {kind:'held',reason:error.message,metrics};}
 }});
}
