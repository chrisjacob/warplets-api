import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {hashLegacyAdoptionCertificate,verifyLegacyAdoptionActivationReceipt,legacyImportedAdmissionTotalsSql} from '../collect/legacy-adoption-authority.mjs';
import {hashJson} from './inventory.mjs';
const size=v=>utf8(canonicalJson(v)).length,same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const need=(yes,reason)=>{if(!yes)throw new TypeError('Recovery imported authority '+reason);};
const certFields=['id','inventory_id','activation_command_id','root_id','source_revision','raw_digest','canonical_digest','origin_digest','source_generation','source_watermark','schema_fingerprint','economic_audit_id','economic_selection_digest','economic_chain_digest','economic_result_json','economic_result_digest','parent_digest','parent_preimage_json','quiescence_json','preparation_digest','preparation_result_json','preparation_result_digest','stage_count','admitted','fulfilled','remaining_json','operator','created_ms'];
const receiptFields=['operation_id','state','operation_kind','principal_key','business_key','result_ref','request_key','created_ms','input_json','result_json','request_digest','output_digest','expected_revisions'];
function slotsSql(inventoryId,kind,tranche){
 let total=0;const level=LEVEL_QUOTAS.map((q,n)=>`WHEN idx<${total+=q} THEN ${n+1}`).join(' ');
 return sql(`WITH raw AS (
 SELECT json_extract(body_json,'$.originalOutcome.slot') slot FROM app_collection_legacy_mint_anchors WHERE inventory_id=?
 UNION ALL SELECT json_extract(f.effect_json,'$.asset.slotJson') FROM app_collection_mint_fulfillments f JOIN app_collection_mint_admissions m ON m.operation_id=f.operation_id WHERE m.inventory_id=?
 ), parsed AS(SELECT CASE WHEN json_valid(slot) AND length(CAST(slot AS BLOB))<=512 THEN slot ELSE '{}' END slot FROM raw), fields AS(
 SELECT slot,json_extract(slot,'$.kind') kind,json_extract(slot,'$.tranche') tranche,json_extract(slot,'$.level') lev,json_extract(slot,'$.ordinal') ord,json_extract(slot,'$.seasonId') season,json_extract(slot,'$.slotIndex') idx FROM parsed
 ), checked AS(SELECT *,CASE WHEN ?='genesis' THEN kind='genesis' AND tranche=? AND json_type(slot,'$.tranche')='integer' AND json_type(slot,'$.level')='integer' AND lev BETWEEN 1 AND 10 AND json_type(slot,'$.ordinal')='integer' AND ord>=0 AND ord<json_extract(?, '$['||(lev-1)||']') AND (SELECT COUNT(*) FROM json_each(slot))=4 ELSE kind='season' AND season=? AND json_type(slot,'$.slotIndex')='integer' AND idx BETWEEN 0 AND 999 AND (SELECT COUNT(*) FROM json_each(slot))=3 END valid FROM fields
 ), normalized AS(SELECT CASE WHEN valid IS 1 THEN CASE WHEN kind='genesis' THEN lev ELSE CASE ${level} ELSE 0 END END ELSE 0 END level,json_array(kind,tranche,lev,ord,season,idx) slot_key,valid FROM checked)
 SELECT COUNT(*) total,COUNT(DISTINCT slot_key) unique_slots,COALESCE(SUM(valid IS NOT 1),0) invalid,(SELECT json_group_array(json_object('level',level,'count',n)) FROM (SELECT level,COUNT(*) n FROM normalized GROUP BY level)) levels FROM normalized`,inventoryId,inventoryId,kind,tranche,canonicalJson(LEVEL_QUOTAS),inventoryId);
}
/** Called only after aggregate adoption semantics are durably proved. Historical
 * anchors remain historical; no045/046 rows or historical receipts are invented. */
export async function verifyRecoveryImportedAuthority(value,{driver,crypto,onMeasure=(_metrics)=>{}}){
 let decoded=parseRecoveryV2Checkpoint(canonicalJson(value.c));const checkpointBytes=utf8(value.loaded.run.checkpoint_json).length,checkpointWorkingBytes=Math.max(checkpointBytes,size(decoded)),checkpointMatches=same(decoded,parseRecoveryV2Checkpoint(value.loaded.run.checkpoint_json));
 // Retain only the captured IDs/fence fields during certificate and aggregate
 // reads; the outer reconciler owns the original full checkpoint for its CAS.
 const q=JSON.parse(canonicalJson({authority:value.authority,loaded:{run:{id:value.loaded.run.id},state:value.loaded.state},c:{targetWatermark:value.c.targetWatermark}})),{loaded,c,authority:a}=q;value=null;decoded=null;
 const metrics={sql:0,maxBatchBytes:0,maxReturnedBytes:0,checkpointBytes,maxWorkingBytes:0};let retained=size(a);
 const working=n=>{metrics.maxWorkingBytes=Math.max(metrics.maxWorkingBytes,3*checkpointWorkingBytes+3*retained+n+32768);need(metrics.maxWorkingBytes<=1048576,'working bound.');};
 const read=async statements=>{const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);need(metrics.sql+12<=64,'operation bound.');const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,n);need(n<=262144,'read bound.');working(n*4+m.batchBytes*2);return rows;};
 try{
  need(checkpointMatches&&loaded.state.mode==='private'&&loaded.state.status==='restoring'&&loaded.state.active_restore_id===loaded.run.id&&loaded.state.write_nonce===null&&a.origin_kind==='verified-source-import','private pinned target.');
  let [certs,pins]=await read([sql(`SELECT ${certFields.join(',')} FROM app_collection_legacy_adoptions WHERE inventory_id=? AND length(CAST(json_array(${certFields.join(',')}) AS BLOB))<=65536`,a.inventory_id),sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);
  need(certs.length===1&&pins[0]?.revision===c.targetWatermark,'certificate or target watermark.');let row=certs[0];retained+=size(row);working(size(row)*5);const verified=await hashLegacyAdoptionCertificate(row,crypto),b=verified.body;
  need(a.inventory_id===b.inventoryId&&a.initial_revision===b.sourceRevision&&a.header_revision===b.sourceRevision&&a.initial_state_digest===b.rawDigest&&a.activation_command_id===row.activation_command_id&&a.origin_digest===b.originDigest,'historical source identity.');
  const [receipts,proofs,totals,stages,slots]=await read([
   sql(`SELECT ${receiptFields.join(',')} FROM app_command_receipts WHERE operation_id=? AND length(CAST(json_array(${receiptFields.join(',')}) AS BLOB))<=32768`,row.activation_command_id),
   sql("SELECT item_count,result_digest FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='legacy-adoption-complete' AND scope=? AND ordinal=0 AND target_watermark=?",loaded.run.id,b.adoptionId,c.targetWatermark),
   legacyImportedAdmissionTotalsSql({inventoryId:b.inventoryId,historicalAdmissions:b.admitted,fulfilled:a.fulfilled}),
   sql(`SELECT COUNT(*) total,COUNT(DISTINCT ordinal) ordinals,COALESCE(MIN(ordinal),0) first_ordinal,COALESCE(MAX(ordinal),-1) last_ordinal,
    (SELECT COUNT(*) FROM app_collection_legacy_stage_imports WHERE inventory_id=?) imported,
    (SELECT COUNT(*) FROM app_collection_mint_admissions m LEFT JOIN app_collection_mint_fulfillments f ON f.operation_id=m.operation_id LEFT JOIN app_command_receipts r ON r.operation_id=f.command_operation_id WHERE m.inventory_id=? AND (m.admitted_ms<? OR (f.operation_id IS NOT NULL AND (r.created_ms IS NULL OR r.created_ms<?)))) invalid_times,
    COALESCE(SUM(CASE WHEN s.ordinal<? THEN NOT EXISTS(SELECT 1 FROM app_collection_legacy_stage_imports i JOIN app_command_receipts r ON r.operation_id=i.command_operation_id WHERE i.inventory_id=s.inventory_id AND i.adoption_id=? AND i.stage_id=s.stage_id AND i.ordinal=s.ordinal AND i.command_operation_id=s.command_operation_id AND r.state='committed' AND r.operation_kind='collection.adopt-legacy-stage.v1') ELSE NOT EXISTS(SELECT 1 FROM app_command_receipts r WHERE r.operation_id=s.command_operation_id AND r.state='committed' AND r.operation_kind='collection.publish-stage.v1' AND r.created_ms>=? AND r.result_ref=json_array(s.inventory_id,s.stage_id) AND json_extract(r.input_json,'$.inventoryId')=s.inventory_id AND json_extract(r.input_json,'$.stageId')=s.stage_id AND json_extract(r.result_json,'$.inventoryId')=s.inventory_id AND json_extract(r.result_json,'$.stageId')=s.stage_id AND json_extract(r.result_json,'$.termsDigest')=s.terms_digest) END),0) invalid FROM app_collection_stages s WHERE inventory_id=?`,b.inventoryId,b.inventoryId,b.createdMs,b.createdMs,b.stageCount,b.adoptionId,b.createdMs,b.inventoryId),
   slotsSql(b.inventoryId,a.kind,a.tranche)
  ]);
  need(receipts.length===1&&await verifyLegacyAdoptionActivationReceipt({receipt:receipts[0],certificate:b,certificateDigest:verified.certificateDigest},crypto)===a.activation_command_id,'activation receipt.');
  need(proofs.length===1&&proofs[0].item_count===b.admitted&&proofs[0].result_digest===await hashJson(crypto,['v2-legacy-adoption-complete',b.adoptionId,verified.certificateDigest]),'complete adoption prerequisite.');
  const n=totals[0],s=stages[0],slot=slots[0];need(n&&Object.entries(n).every(([k,v])=>['first_ordinal','last_ordinal'].includes(k)?v===null||Number.isInteger(v)&&v>=0&&v<1000:Number.isInteger(v)&&v>=0&&v<=1000)&&n.admitted===a.admitted&&n.fulfilled===a.fulfilled&&n.historical_count===b.admitted&&n.actual_operations===a.admitted&&['operation_count','ordinal_count','commitment_count','owner_key_count'].every(k=>n[k]===a.admitted)&&n.invalid_prefix===0&&n.invalid_binding===0&&(a.admitted===0?n.first_ordinal===null&&n.last_ordinal===null:n.first_ordinal===0&&n.last_ordinal===a.admitted-1),'combined admission lineage and prefix.');
  need(s&&s.total<=32&&s.imported===b.stageCount&&s.total>=s.imported&&s.ordinals===s.total&&s.first_ordinal===0&&s.last_ordinal===s.total-1&&s.invalid===0&&s.invalid_times===0&&a.revision===s.total-s.imported+n.modern_count+n.modern_fulfilled,'combined revision, time and stage prefix.');
  need(slot&&slot.total===a.fulfilled&&slot.unique_slots===a.fulfilled&&slot.invalid===0,'combined unique original slots.');const levels=JSON.parse(slot.levels),remaining=[...LEVEL_QUOTAS];need(Array.isArray(levels)&&levels.length<=10,'slot level groups.');for(const r of levels){need(Number.isInteger(r.level)&&r.level>=1&&r.level<=10&&Number.isInteger(r.count)&&r.count>0&&r.count<=LEVEL_QUOTAS[r.level-1],'slot quota.');remaining[r.level-1]-=r.count;}
  need(same(remaining,JSON.parse(a.remaining_json))&&a.origin_digest===await crypto.sha256(utf8(JSON.stringify([a.inventory_id,a.kind,a.tranche,a.season_start]))),'original-slot quota conservation.');
  const counts={historicalAdmissions:n.historical_count,newAdmissions:n.modern_count,newFulfillments:n.modern_fulfilled,totalStages:s.total,importedStages:s.imported,newStages:s.total-s.imported,admitted:n.admitted,fulfilled:n.fulfilled};
  certs=null;row=null;retained=size({a,b,counts,remaining});const [after]=await read([sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);need(after[0]?.revision===c.targetWatermark,'target changed.');
  return {counts,remaining,revision:a.revision,adoptionId:b.adoptionId,certificateDigest:verified.certificateDigest};
 }finally{onMeasure({...metrics,operationAllowance:metrics.sql+12});}
}
