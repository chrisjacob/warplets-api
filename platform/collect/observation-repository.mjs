import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildCollectionObservationCommand,OBSERVE_COLLECTION_ASSET} from './observation-service.mjs';
import {verifyCollectionObservationEvidence,MAX_COLLECTION_OBSERVATION_BYTES} from './observation-evidence.mjs';
import {prepareCollectionObservation} from './observation-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const demand=(c,message)=>{if(!c)throw new TypeError(message);};
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence' AND enabled=1)";
const bounded=(column,size,alias=column.split('.').at(-1))=>`CASE WHEN length(CAST(${column} AS BLOB))<=${size} THEN ${column} ELSE NULL END ${alias}`;
/** Private evidence application. All raw bytes and source facts are independently
 * verified here; a service-supplied boolean cannot authorize asset mutation. */
export function createCollectionObservationRepository(driver,ports){
 const {crypto,clock,artifacts}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 return Object.freeze({async observe(value){
  const c=clone(value);demand(c&&Object.keys(c).length===6&&c.operationKind===OBSERVE_COLLECTION_ASSET,'Invalid collection observation command.');
  demand(canonicalJson(c)===canonicalJson(await buildCollectionObservationCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto)),'Observation request digest or identity mismatch.');
  const prior=await replay(c);if(prior)return prior;const i=c.input,nowMs=clock.nowMs(),sourceId='evidence:'+i.evidenceReceiptId;
  if(!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000||i.observedMs>nowMs)return pending('observation-clock-unavailable');
  const captured=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence'",c.principal.id),
   sql('SELECT source_id FROM app_collection_observation_bindings WHERE source_id=?',sourceId),
   sql(`SELECT r.receipt_digest,${bounded('r.stream_key',4096)},${bounded('r.source_revision',1024)},${bounded('r.source_id',1024)},${bounded('r.object_key',512)},${bounded('r.envelope_json',16384)},${bounded('r.decision_json',16384)},${bounded('r.status',32)},
    ${bounded('s.config_json',65536)},${bounded('s.config_digest',64)},${bounded('h.receipt_digest',64,'head_digest')},${bounded('a.byte_digest',64)},a.size,${bounded('a.content_type',128)},a.semantic_digest IS NULL artifact_is_raw,${bounded('rc.state',32,'receipt_state')}
    FROM app_evidence_receipts r JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision
    JOIN app_command_receipts rc ON rc.operation_id=r.operation_id
    LEFT JOIN app_evidence_heads h ON h.stream_key=r.stream_key LEFT JOIN app_private_artifacts a ON a.object_key=r.object_key WHERE r.receipt_digest=?`,i.evidenceReceiptId),
   sql(`SELECT a.id,${bounded('a.inventory_id',128)},${bounded('a.owner',64)},a.bind_ms,a.observed_ms,a.reveal_ms,${bounded('a.slot',4096)},${bounded('a.asset',16384)},${bounded('inv.kind',16,'inventory_kind')},inv.tranche inventory_tranche,inv.season_start FROM collect_assets a JOIN collect_inventories inv ON inv.id=a.inventory_id WHERE a.id=?`,i.assetId),
   sql(`SELECT id,${bounded('slot_key',4096)},${bounded('coords',4096)},${bounded('owner',64)},latest_ms FROM vault_assets WHERE id=?`,i.assetId),
   sql(`SELECT ${bounded('event_id',128)},asset_id,kind,observed_ms,${bounded('body',4096)} FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1`,i.assetId),
   sql(`SELECT ${bounded('id',128)},${bounded('kind',16)},${bounded('inventory_id',128)},${bounded('owner',64)},${bounded('commitment',512)},settled_ms,${bounded('operation',16384)} FROM collect_operations WHERE id=(SELECT CASE WHEN length(CAST(asset AS BLOB))<=16384 AND json_valid(asset) THEN json_extract(asset,'$.pending') ELSE NULL END FROM collect_assets WHERE id=?)`,i.assetId),
  ]);
  const [versionRows,grants,existing,evidenceRows,assets,vaults,owners,operations]=clone(captured);
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');if(existing.length)return conflict('observation_already_recorded');
  if(utf8(canonicalJson(captured)).length>196608)return pending('observation-input-byte-bound');
  if(versionRows.length!==3||new Set(versionRows.map(r=>r.name)).size!==3||versionRows.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^\d+$/.test(r.revision)))return pending('observation-revisions-unavailable');
  const version=revisions(versionRows),e=evidenceRows[0],a=assets[0],v=vaults[0],o=owners[0],op=operations[0]??null;
  if(e&&['stream_key','source_revision','source_id','object_key','envelope_json','decision_json','config_json','config_digest'].some(k=>e[k]===null)||a&&['inventory_id','owner','slot','asset','inventory_kind'].some(k=>a[k]===null)||v&&['slot_key','coords','owner'].some(k=>v[k]===null))return pending('observation-read-byte-bound');
  if(!e)return pending('observation-evidence-missing');
  if(e.head_digest!==i.evidenceReceiptId)return pending('observation-evidence-head-changed');
  if(e.status!=='verified'||e.receipt_state!=='committed'||e.byte_digest!==i.evidenceDigest||!Number.isSafeInteger(e.size)||e.size<1||e.size>MAX_COLLECTION_OBSERVATION_BYTES||e.content_type!=='application/json'||e.artifact_is_raw!==1)return pending('observation-evidence-unavailable');
  const identity={key:e.object_key,byteDigest:e.byte_digest,size:e.size,semanticDigest:null,visibility:'private',contentType:'application/json'};let artifact;
  try{artifact=await artifacts.getVerified(identity);}catch{return pending('observation-artifact-unavailable');}
  if(artifact.status!=='verified')return pending('observation-artifact-'+artifact.status);
  let verified,plan;
  try{
   verified=await verifyCollectionObservationEvidence({source:JSON.parse(e.config_json),envelope:JSON.parse(e.envelope_json),decision:JSON.parse(e.decision_json),receiptDigest:i.evidenceReceiptId,bytes:artifact.bytes},crypto);
   if(verified.byteDigest!==i.evidenceDigest||verified.source.sourceId!==e.source_id||verified.source.sourceRevision!==e.source_revision||verified.sourceConfigDigest!==e.config_digest||verified.streamKey!==e.stream_key||verified.envelope.objectRef!==e.object_key||verified.envelope.ingestedAtMs>nowMs)return pending('observation-evidence-binding');
   plan=await prepareCollectionObservation({input:i,event:verified.event,asset:a??null,inventory:a?{id:a.inventory_id,kind:a.inventory_kind,tranche:a.inventory_tranche,season_start:a.season_start}:null,vault:v??null,ownerEvidence:o??null,operation:op,nowMs},crypto);
  }catch(error){return pending(typeof error.code==='string'?error.code:'observation-evidence-invalid');}
  const {effect,result,conflict:hold}=plan,effectJson=canonicalJson(effect),resultJson=canonicalJson(result);
  const authority=[grant,`${nowSql}>=?`,
   'EXISTS(SELECT 1 FROM app_evidence_heads WHERE stream_key=? AND receipt_digest=?)',
   "EXISTS(SELECT 1 FROM app_evidence_receipts WHERE receipt_digest=? AND status='verified' AND envelope_json=? AND decision_json=?)",
   'EXISTS(SELECT 1 FROM app_evidence_sources WHERE source_id=? AND source_revision=? AND config_digest=?)',
   'EXISTS(SELECT 1 FROM app_private_artifacts WHERE object_key=? AND byte_digest=? AND size=?)',
   'NOT EXISTS(SELECT 1 FROM app_collection_observation_bindings WHERE source_id=?)',
   'EXISTS(SELECT 1 FROM collect_assets WHERE id=? AND inventory_id=? AND owner=? AND asset=? AND observed_ms=? AND reveal_ms IS ? AND slot=?)',
   'EXISTS(SELECT 1 FROM vault_assets WHERE id=? AND owner=? AND latest_ms=? AND coords=? AND slot_key=?)',
   ...(hold?["EXISTS(SELECT 1 FROM collect_operations WHERE id=? AND operation=? AND settled_ms IS NULL)"]:[]),
  ].join(' AND ');
  const values=[c.principal.id,nowMs,e.stream_key,i.evidenceReceiptId,i.evidenceReceiptId,e.envelope_json,e.decision_json,e.source_id,e.source_revision,e.config_digest,e.object_key,e.byte_digest,e.size,sourceId,a.id,a.inventory_id,a.owner,a.asset,a.observed_ms,a.reveal_ms,a.slot,v.id,v.owner,v.latest_ms,v.coords,v.slot_key,...(hold?[op.id,op.operation]:[])];
  return execute({...c,nowMs,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:sourceId,version,authoritySql:authority,authorityValues:values,child:(gate,p)=>[
   sql(`UPDATE collect_assets SET asset=?,owner=?,observed_ms=?,reveal_ms=? WHERE id=? AND asset=? AND owner=? AND ${gate}`,effect.assetAfterJson,result.owner,effect.collectObservedMs,effect.revealMs,a.id,a.asset,a.owner,...p),
   ...(i.kind==='transfer'?[
    sql(`UPDATE vault_assets SET owner=?,latest_ms=? WHERE id=? AND owner=? AND latest_ms=? AND ${gate}`,effect.vaultOwner,effect.vaultLatestMs,v.id,v.owner,v.latest_ms,...p),
    sql(`INSERT INTO vault_observations SELECT ?,?,'transfer',?,? WHERE ${gate}`,effect.vaultEventId,a.id,i.observedMs,effect.vaultEventBodyJson,...p),
   ]:[]),
   sql(`INSERT INTO collect_observations SELECT ?,?,?,?,? WHERE ${gate}`,sourceId,a.id,i.kind,i.observedMs,effect.collectObservationDigest,...p),
   ...(hold?[sql(`INSERT INTO app_collection_operation_conflicts(id,operation_id,asset_id,evidence_receipt_digest,from_wallet,to_wallet,observed_ms,recorded_ms,status,command_operation_id) SELECT ?,?,?,?,?,?,?,?,'held',operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,hold.id,hold.operation_id,hold.asset_id,hold.evidence_receipt_digest,hold.from_wallet,hold.to_wallet,hold.observed_ms,hold.recorded_ms,...p,...p)]:[]),
   sql(`INSERT INTO app_collection_observation_bindings(source_id,asset_id,event_kind,observed_ms,evidence_receipt_digest,byte_digest,stream_key,source_revision,expected_asset_version,result_kind,conflict_id,command_operation_id,result_json,effect_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,operation_id,?,? FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,sourceId,a.id,i.kind,i.observedMs,i.evidenceReceiptId,i.evidenceDigest,e.stream_key,e.source_revision,i.expectedAssetVersion,result.resultKind,result.conflictId,resultJson,effectJson,...p,...p),
  ]});
 }});
}
