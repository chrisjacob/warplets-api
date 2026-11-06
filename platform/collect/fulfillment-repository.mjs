import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildCollectionFulfillmentCommand,FULFILL_COLLECTION_PROGRESSION} from './fulfillment-service.mjs';
import {verifyCollectionProgressionEvidence,MAX_COLLECTION_PROGRESSION_BYTES} from './fulfillment-evidence.mjs';
import {prepareCollectionFulfillment} from './fulfillment-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const demand=(condition,message)=>{if(!condition)throw new TypeError(message);};
const bound=(c,n,alias=c.split('.').at(-1))=>`CASE WHEN length(CAST(${c} AS BLOB))<=${n} THEN ${c} ELSE NULL END ${alias}`;
const participants="SELECT target_id FROM app_collection_reservations WHERE operation_id=? UNION ALL SELECT material_id FROM app_collection_reservations WHERE operation_id=? AND material_id IS NOT NULL";
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence' AND enabled=1)";
/** Guarded040 progression only. No inventory aggregate, chain custody, payment,
 * mutable result approval or request-provided verifier enters this boundary. */
export function createCollectionFulfillmentRepository(driver,ports){
 const {crypto,clock,artifacts,beaconVerifier}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 return Object.freeze({async fulfill(value){
  const c=clone(value);demand(c&&Object.keys(c).length===6&&c.operationKind===FULFILL_COLLECTION_PROGRESSION,'Invalid collection fulfillment command.');demand(canonicalJson(c)===canonicalJson(await buildCollectionFulfillmentCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto)),'Fulfillment request digest or identity mismatch.');
  const prior=await replay(c);if(prior)return prior;const i=c.input,nowMs=clock.nowMs();if(!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000-30000)return pending('fulfillment-clock-unavailable');
  const captured=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence'",c.principal.id),
   sql('SELECT operation_id FROM app_collection_fulfillments WHERE operation_id=?',i.operationId),
   sql(`SELECT r.receipt_digest,${bound('r.stream_key',4096)},${bound('r.source_revision',1024)},${bound('r.source_id',1024)},${bound('r.object_key',512)},${bound('r.envelope_json',16384)},${bound('r.decision_json',16384)},${bound('r.status',32)},${bound('s.config_json',65536)},${bound('s.config_digest',64)},${bound('h.receipt_digest',64,'head_digest')},${bound('a.byte_digest',64)},a.size,${bound('a.content_type',128)},a.semantic_digest IS NULL artifact_is_raw,${bound('rc.state',32,'receipt_state')}
    FROM app_evidence_receipts r JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision JOIN app_command_receipts rc ON rc.operation_id=r.operation_id LEFT JOIN app_evidence_heads h ON h.stream_key=r.stream_key LEFT JOIN app_private_artifacts a ON a.object_key=r.object_key WHERE r.receipt_digest=?`,i.evidenceReceiptId),
   sql(`SELECT id,${bound('kind',16)},${bound('inventory_id',128)},${bound('owner',64)},${bound('commitment',128)},created_ms,settled_ms,${bound('operation',16384)},${bound('proof_id',128)},${bound('evidence_digest',64)},${bound('receipt',16384)},receipt IS NULL receipt_absent,proof_id IS NULL proof_absent,evidence_digest IS NULL evidence_absent FROM collect_operations WHERE id=?`,i.operationId),
   sql(`SELECT r.operation_id,${bound('r.target_id',128)},${bound('r.material_id',128)},${bound('r.target_after_json',16384)},${bound('r.material_after_json',16384)},${bound('r.operation_json',16384)},${bound('r.fair_policy_hash',64)},r.fair_registered_ms,r.target_round,${bound('r.context_digest',64)},${bound('r.result_json',16384)},${bound('rc.state',32,'receipt_state')},${bound('rc.result_json',16384,'receipt_result')},${bound('rc.output_digest',64,'receipt_output_digest')},${bound('rc.principal_key',128,'receipt_principal')},${bound('rc.operation_kind',64,'receipt_kind')},${bound('rc.result_ref',128,'receipt_ref')}
    FROM app_collection_reservations r JOIN app_command_receipts rc ON rc.operation_id=r.command_operation_id WHERE r.operation_id=?`,i.operationId),
   sql(`SELECT i.id,${bound('i.kind',16)},i.tranche,i.season_start,CAST(i.revision AS TEXT) revision FROM collect_inventories i JOIN collect_operations o ON o.inventory_id=i.id WHERE o.id=?`,i.operationId),
   sql(`SELECT id,${bound('inventory_id',128)},${bound('owner',64)},bind_ms,observed_ms,reveal_ms,${bound('slot',4096)},${bound('asset',16384)} FROM collect_assets WHERE id IN (${participants}) ORDER BY id LIMIT 3`,i.operationId,i.operationId),
   sql(`SELECT id,${bound('slot_key',4096)},${bound('coords',4096)},${bound('owner',64)},latest_ms FROM vault_assets WHERE id IN (${participants}) ORDER BY id LIMIT 3`,i.operationId,i.operationId),
   sql(`SELECT ${bound('o.event_id',128)},o.asset_id,o.kind,o.observed_ms,${bound('o.body',4096)} FROM vault_observations o WHERE o.asset_id IN (${participants}) AND o.rowid=(SELECT v.rowid FROM vault_observations v WHERE v.asset_id=o.asset_id AND v.kind IN ('bind','transfer') ORDER BY v.observed_ms DESC,v.rowid DESC LIMIT 1) ORDER BY o.asset_id LIMIT 3`,i.operationId,i.operationId),
   sql(`SELECT ${bound('policy_hash',64)},registered_ms,${bound('traits',524288)} FROM fair_inventories WHERE inventory_id=(SELECT inventory_id FROM collect_operations WHERE id=?)`,i.operationId),
   sql(`SELECT target_round,${bound('context_digest',64)} FROM fair_requests WHERE operation_id=?`,i.operationId),
   sql(`SELECT operation_id,${bound('proof_id',128)},${bound('signed_round',16384)},${bound('fixture',16384)},settled_ms FROM fair_results WHERE operation_id=?`,i.operationId),
   sql("SELECT id FROM app_collection_operation_conflicts WHERE operation_id=? AND status='held' LIMIT 1",i.operationId),
   sql('SELECT MAX(v.activated_ms) latest FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id'),
  ]);
  if(utf8(canonicalJson(captured)).length>1048576)return pending('fulfillment-input-byte-bound');
  const [versionRows,grants,existing,evidenceRows,operations,reservations,inventories,assets,vaults,owners,policies,requests,results,holds,snapshots]=clone(captured);
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');if(existing.length)return conflict('operation_already_fulfilled');
  if(versionRows.length!==3||new Set(versionRows.map(r=>r.name)).size!==3||versionRows.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)))return pending('fulfillment-revisions-unavailable');
  const version=revisions(versionRows),e=evidenceRows[0],op=operations[0],r=reservations[0],inventory=inventories[0],policy=policies[0]??null,request=requests[0]??null,existingFair=results[0]??null;
  if(!op||!r||!inventory)return pending('guarded-progression-reservation-missing');if(op.settled_ms!==null||op.receipt_absent!==1||op.proof_absent!==1||op.evidence_absent!==1)return pending('operation-already-settled');if(holds.length)return pending('operation-external-transfer-held');
  if(!e)return pending('fulfillment-evidence-missing');if(e.head_digest!==i.evidenceReceiptId)return pending('fulfillment-evidence-head-changed');
  if(e.status!=='verified'||e.receipt_state!=='committed'||e.byte_digest!==i.evidenceDigest||!Number.isSafeInteger(e.size)||e.size<1||e.size>MAX_COLLECTION_PROGRESSION_BYTES||e.content_type!=='application/json'||e.artifact_is_raw!==1)return pending('fulfillment-evidence-unavailable');
  if(['config_json','envelope_json','decision_json','source_id','source_revision','object_key','stream_key','config_digest'].some(k=>e[k]===null)||['operation','owner','inventory_id','kind','commitment'].some(k=>op[k]===null)||['target_id','target_after_json','operation_json','result_json','receipt_result','receipt_output_digest'].some(k=>r[k]===null)||assets.some(a=>['asset','slot','inventory_id','owner'].some(k=>a[k]===null))||vaults.some(v=>['coords','slot_key','owner'].some(k=>v[k]===null)))return pending('fulfillment-read-byte-bound');
  if(r.receipt_state!=='committed'||r.receipt_kind!=='collection.reserve-operation.v1'||r.receipt_principal!=='wallet:'+op.owner||r.receipt_ref!==op.id||r.receipt_result!==r.result_json)return pending('fulfillment-reservation-receipt-conflict');
  let artifact;const identity={key:e.object_key,byteDigest:e.byte_digest,size:e.size,semanticDigest:null,visibility:'private',contentType:'application/json'};
  try{artifact=await artifacts.getVerified(identity);}catch{return pending('fulfillment-artifact-unavailable');}if(artifact.status!=='verified')return pending('fulfillment-artifact-'+artifact.status);
  let verified,plan;
  try{
   const originalResult=JSON.parse(r.result_json);if(await crypto.sha256(utf8(canonicalJson(originalResult)))!==r.receipt_output_digest||originalResult.operationId!==op.id||originalResult.targetId!==r.target_id||originalResult.materialId!==r.material_id||originalResult.kind!==op.kind||originalResult.inventoryId!==op.inventory_id||originalResult.wallet!==op.owner||originalResult.fairness!==(r.fair_policy_hash===null?'manual-fixture':'configured-offline-beacon'))return pending('fulfillment-reservation-receipt-conflict');
   verified=await verifyCollectionProgressionEvidence({source:JSON.parse(e.config_json),envelope:JSON.parse(e.envelope_json),decision:JSON.parse(e.decision_json),receiptDigest:i.evidenceReceiptId,bytes:artifact.bytes},crypto);
   if(verified.byteDigest!==i.evidenceDigest||verified.source.sourceId!==e.source_id||verified.source.sourceRevision!==e.source_revision||verified.sourceConfigDigest!==e.config_digest||verified.streamKey!==e.stream_key||verified.envelope.objectRef!==e.object_key||verified.envelope.ingestedAtMs>nowMs)return pending('fulfillment-evidence-binding');
   plan=await prepareCollectionFulfillment({input:i,event:verified.event,operation:op,reservation:r,inventory,assets,vaults,owners,fairPolicy:policy,fairRequest:request,existingFairResult:existingFair,holdCount:holds.length,snapshotConflict:snapshots[0]?.latest!==null&&snapshots[0]?.latest>=(verified.event.provenance==='configured-offline-beacon'?nowMs:verified.event.atMs),nowMs},crypto,beaconVerifier);
  }catch(error){return pending(typeof error.code==='string'?error.code:'fulfillment-evidence-invalid');}
  const {result,effect}=plan,writes=[effect.target,...(effect.material?[effect.material]:[])],fair=effect.fairResult;
  const authority=[grant,`${nowSql}>=? AND ${nowSql}<=?`,
   'EXISTS(SELECT 1 FROM app_evidence_heads WHERE stream_key=? AND receipt_digest=?)',
   'EXISTS(SELECT 1 FROM app_evidence_sources WHERE source_id=? AND source_revision=? AND config_digest=?)',
   'EXISTS(SELECT 1 FROM app_private_artifacts WHERE object_key=? AND byte_digest=? AND size=? AND semantic_digest IS NULL)',
   'NOT EXISTS(SELECT 1 FROM app_collection_fulfillments WHERE operation_id=?)',
   "NOT EXISTS(SELECT 1 FROM app_collection_operation_conflicts WHERE operation_id=? AND status='held')",
   'EXISTS(SELECT 1 FROM collect_operations WHERE id=? AND operation=? AND owner=? AND settled_ms IS NULL AND receipt IS NULL AND proof_id IS NULL AND evidence_digest IS NULL)',
   'NOT EXISTS(SELECT 1 FROM collect_operations WHERE proof_id=?)',
   ...writes.map(()=>`EXISTS(SELECT 1 FROM collect_assets WHERE id=? AND asset=? AND owner=? AND observed_ms=? AND slot=? AND reveal_ms=? AND bind_ms=?)`),
   ...writes.map(()=>`EXISTS(SELECT 1 FROM vault_assets WHERE id=? AND owner=? AND latest_ms=? AND coords=? AND slot_key=?)`),
   ...(op.kind==='upgrade'?['NOT EXISTS(SELECT 1 FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id WHERE v.activated_ms>=?)']:[]),
   ...(fair?['EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=? AND policy_hash=? AND registered_ms=?)','EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=? AND target_round=? AND context_digest=?)']:['NOT EXISTS(SELECT 1 FROM fair_inventories WHERE inventory_id=?)','NOT EXISTS(SELECT 1 FROM fair_requests WHERE operation_id=?)']),
   existingFair?'EXISTS(SELECT 1 FROM fair_results WHERE operation_id=? AND proof_id=? AND signed_round=? AND fixture=? AND settled_ms=?)':'NOT EXISTS(SELECT 1 FROM fair_results WHERE operation_id=? OR proof_id=?)',
  ].join(' AND ');
  const values=[c.principal.id,nowMs,nowMs+30000,e.stream_key,i.evidenceReceiptId,e.source_id,e.source_revision,e.config_digest,e.object_key,e.byte_digest,e.size,op.id,op.id,op.id,op.operation,op.owner,result.proofId,...writes.flatMap(w=>[w.id,w.beforeJson,op.owner,w.beforeObservedMs,w.slotJson,w.revealMs,w.bindMs]),...writes.flatMap(w=>[w.id,w.vaultOwner,w.vaultLatestMs,w.vaultCoordsJson,w.vaultSlotKey]),...(op.kind==='upgrade'?[result.effectiveMs]:[]),...(fair?[op.inventory_id,policy.policy_hash,policy.registered_ms,op.id,request.target_round,request.context_digest]:[op.inventory_id,op.id]),...(existingFair?[op.id,existingFair.proof_id,existingFair.signed_round,existingFair.fixture,existingFair.settled_ms]:[op.id,result.proofId])];
  const outcome=await execute({...c,nowMs,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:op.id,version,authoritySql:authority,authorityValues:values,child:(gate,p)=>[
   ...writes.map(w=>sql(`UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=? AND asset=? AND ${gate}`,w.afterJson,result.effectiveMs,w.id,w.beforeJson,...p)),
   ...effect.history.map(h=>sql(`INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref) SELECT ?,?,?,? WHERE ${gate}`,h.assetId,h.effectiveMs,h.level,h.sourceRef,...p)),
   ...(fair&&!existingFair?[sql(`INSERT INTO fair_results(operation_id,proof_id,signed_round,fixture,settled_ms) SELECT ?,?,?,?,? WHERE ${gate}`,op.id,fair.proofId,fair.signedRoundJson,fair.fixtureJson,fair.settledMs,...p)]:[]),
   sql(`INSERT INTO app_collection_fulfillments(operation_id,evidence_receipt_digest,byte_digest,stream_key,source_revision,provenance,proof_id,effective_ms,command_operation_id,result_json,effect_json) SELECT ?,?,?,?,?,?,?,?,operation_id,?,? FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,op.id,i.evidenceReceiptId,i.evidenceDigest,e.stream_key,e.source_revision,result.provenance,result.proofId,result.effectiveMs,canonicalJson(result),canonicalJson(effect),...p,...p),
   sql(`UPDATE collect_operations SET settled_ms=?,proof_id=?,evidence_digest=?,receipt=? WHERE id=? AND settled_ms IS NULL AND ${gate}`,result.effectiveMs,result.proofId,effect.legacyEvidenceDigest,effect.operationReceiptJson,op.id,...p),
  ]});
  if(outcome.kind==='conflict'&&(clock.nowMs()<nowMs||clock.nowMs()>nowMs+30000))return pending('fulfillment-preparation-window-expired');return outcome;
 }});
}
