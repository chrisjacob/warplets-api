import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {readRecoveryV2SourceMetadata,recoveryV2SchemaFence} from '../recovery/v2-schema.mjs';
import {createLegacyRawStateAudit} from './legacy-raw-state-audit.mjs';
import {createLegacyStateAudit} from './legacy-state-audit.mjs';
const clone=v=>JSON.parse(canonicalJson(v)),id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const need=(ok,message)=>{if(!ok)throw new TypeError('Legacy private audit '+message);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const scope="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-import' AND enabled=1)";
const sourceFence=alias=>`EXISTS(SELECT 1 FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1 AND r.generation=json_extract(${alias}.descriptor_json,'$.sourceGeneration') AND w.revision=json_extract(${alias}.descriptor_json,'$.sourceWatermark') AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL) AND EXISTS(SELECT 1 FROM collect_inventories c WHERE c.id=${alias}.inventory_id AND c.revision=${alias}.source_revision) AND ${recoveryV2SchemaFence(alias+'.descriptor_json')}`;
const columns='id,operator,inventory_id,root_id,source_revision,declared_state_digest,state,phase,revision,checkpoint_json,raw_digest,canonical_digest,last_nonce,reason,created_ms,updated_ms';
/** Private preparatory read workflow. No caller checkpoint, active collection
 * authority or accepted economic receipt is created. Durable prefixes are
 * excluded recovery controls and invalid after any frozen business mutation. */
export function createLegacyAuditRepository({driver,crypto,clock,ids,schema,createHashAdapter,onMeasure=()=>{}}){
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 function principal(value){need(exact(value,['kind','id'])&&value.kind==='operator'&&id(value.id),'operator principal');return clone(value);}
 function now(){const value=clock.nowMs();need(Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000,'clock');return value;}
 function nonce(){const value=ids.next();need(id(value),'attempt nonce');return value;}
 async function load(auditId,operator){const [rows]=await read([sql(`SELECT ${columns},CASE WHEN ${sourceFence('a')} THEN 1 ELSE 0 END source_current FROM app_collection_legacy_audits a WHERE a.id=? AND a.operator=? AND ${scope}`,auditId,operator,operator)]);need(rows.length<=1&&utf8(canonicalJson(rows)).length<=16384,'bounded run read');return rows[0]??null;}
 const conflict=code=>({kind:'conflict',code});
 function outcome(run,kind='progress'){if(!run)return conflict('audit-not-found-or-scope');if(run.state==='held')return {kind:'held',auditId:run.id,revision:run.revision,reason:run.reason};if(!run.source_current)return {kind:'held',auditId:run.id,revision:run.revision,reason:'audit-source-changed'};return {kind:run.state==='fingerprints-ready'?'fingerprints-ready':kind,auditId:run.id,revision:run.revision,phase:run.phase,...(run.state==='fingerprints-ready'?{inventoryId:run.inventory_id,rootId:run.root_id,rawStateDigest:run.raw_digest,canonicalStateDigest:run.canonical_digest,sourceRelation:false,economics:false,adoption:false,executable:false}:{})};}
 async function save(run,operator,next,{hold=false}={}){
  const checkpoint=next.checkpoint===null?null:canonicalJson(next.checkpoint);need(checkpoint===null||utf8(checkpoint).length<=8192,'checkpoint bound');const attempt=nonce(),time=now();
  let unknown=false,changed=0;
  try{const results=await driver.batch([sql(`UPDATE app_collection_legacy_audits AS a SET state=?,phase=?,checkpoint_json=?,raw_digest=?,canonical_digest=?,reason=?,revision=revision+1,last_nonce=?,updated_ms=? WHERE id=? AND operator=? AND state='working' AND revision=? AND phase=? AND checkpoint_json IS ? AND raw_digest IS ? AND canonical_digest IS ? AND last_nonce=? AND ${scope}${hold?'':' AND '+sourceFence('a')}`,next.state,next.phase,checkpoint,next.rawDigest,next.canonicalDigest,next.reason,attempt,time,run.id,operator,run.revision,run.phase,run.checkpoint_json,run.raw_digest,run.canonical_digest,run.last_nonce,operator)]);changed=results[0]?.changes??0;}catch{unknown=true;}
  const latest=await load(run.id,operator);if(!latest)return conflict('audit-not-found-or-scope');if(latest.revision>run.revision)return outcome(latest,changed>0&&latest.last_nonce===attempt?'progress':'replayed');
  if(!latest.source_current)return outcome(latest);return conflict(unknown?'audit-write-unknown':'audit-write-conflict');
 }
 async function hold(run,operator,reason){return save(run,operator,{state:'held',phase:run.phase,checkpoint:run.checkpoint_json===null?null:JSON.parse(run.checkpoint_json),rawDigest:run.raw_digest,canonicalDigest:run.canonical_digest,reason},{hold:true});}
 return Object.freeze({
  async start(who,input){const p=principal(who),request=clone(input);need(exact(request,['auditId','inventoryId','rootId'])&&id(request.auditId)&&id(request.inventoryId)&&digest(request.rootId),'start fields');
   const old=await load(request.auditId,p.id);if(old)return old.inventory_id===request.inventoryId&&old.root_id===request.rootId?outcome(old,'replayed'):conflict('audit-identity-conflict');
   const [grants,roots]=await read([sql(`SELECT 1 enabled WHERE ${scope}`,p.id),sql('SELECT s.declared_state_digest,c.revision FROM app_collection_source_seals s JOIN collect_inventories c ON c.id=s.inventory_id AND CAST(c.revision AS TEXT)=s.source_revision WHERE s.id=? AND c.id=?',request.rootId,request.inventoryId)]);if(grants.length!==1)return conflict('operator-scope-required');if(roots.length!==1)return conflict('audit-source-root-unavailable');
   let descriptor;try{descriptor=await readRecoveryV2SourceMetadata(driver,{schema,crypto});}catch{return conflict('audit-source-schema-unavailable');}
   const time=now(),attempt=nonce(),value={...request,source_revision:roots[0].revision};let unknown=false;
   try{await driver.batch([sql(`WITH candidate AS (SELECT ? descriptor_json,? inventory_id,CAST(? AS INTEGER) source_revision) INSERT INTO app_collection_legacy_audits(id,operator,inventory_id,root_id,source_revision,declared_state_digest,descriptor_json,state,phase,revision,checkpoint_json,raw_digest,canonical_digest,last_nonce,reason,created_ms,updated_ms) SELECT ?,?,inventory_id,?,source_revision,?,descriptor_json,'working','raw',0,NULL,NULL,NULL,?,NULL,?,? FROM candidate WHERE ${scope} AND ${sourceFence('candidate')} AND EXISTS(SELECT 1 FROM app_collection_source_seals s WHERE s.id=? AND s.inventory_id=candidate.inventory_id AND s.source_revision=CAST(candidate.source_revision AS TEXT) AND s.declared_state_digest=?) ON CONFLICT(id) DO NOTHING`,canonicalJson(descriptor),request.inventoryId,value.source_revision,request.auditId,p.id,request.rootId,roots[0].declared_state_digest,attempt,time,time,p.id,request.rootId,roots[0].declared_state_digest)]);}catch{unknown=true;}
   const saved=await load(request.auditId,p.id);if(!saved)return conflict(unknown?'audit-start-unknown':'audit-start-conflict');return saved.inventory_id===request.inventoryId&&saved.root_id===request.rootId?outcome(saved,unknown?'replayed':'started'):conflict('audit-identity-conflict');
  },
  async step(who,input){const p=principal(who),request=clone(input);need(exact(request,['auditId','expectedRevision'])&&id(request.auditId)&&Number.isSafeInteger(request.expectedRevision)&&request.expectedRevision>=0,'step fields');const run=await load(request.auditId,p.id);if(!run)return conflict('audit-not-found-or-scope');if(run.revision!==request.expectedRevision)return run.revision>request.expectedRevision?outcome(run,'replayed'):conflict('audit-revision-conflict');if(run.state!=='working'||!run.source_current)return outcome(run);
   const checkpoint=run.checkpoint_json===null?null:JSON.parse(run.checkpoint_json),hash=createHashAdapter();let result,recordTransportBytes=0;
   if(run.phase==='raw')result=await createLegacyRawStateAudit({driver,hash}).step({inventoryId:run.inventory_id,checkpoint});
   else result=await createLegacyStateAudit({crypto,hash,readRecord:async recordId=>{const [rows]=await read([sql('SELECT id,size,body_base64 FROM app_collection_records WHERE id=?',recordId)]);if(rows.length!==1)return null;const r=rows[0];recordTransportBytes+=utf8(canonicalJson(rows)).length;need(Number.isSafeInteger(r.size)&&r.size>0&&r.size<=131072&&typeof r.body_base64==='string'&&r.body_base64.length===4*Math.ceil(r.size/3),'record bound');return {id:r.id,size:r.size,bytes:Uint8Array.from(atob(r.body_base64),c=>c.charCodeAt(0))};}}).step({rootId:run.root_id,checkpoint});
   const measurement={phase:run.phase,coreWorkingBytes:result.metrics.maxWorkingBytes,controlBytes:utf8(canonicalJson(run)).length,recordTransportBytes};measurement.workingBytes=measurement.coreWorkingBytes+measurement.controlBytes*3+recordTransportBytes+16384;onMeasure(measurement);if(measurement.workingBytes>1048576)return hold(run,p.id,'audit-working-byte-bound');
   if(result.kind==='held')return hold(run,p.id,result.reason);if(result.kind==='continue')return save(run,p.id,{state:'working',phase:run.phase,checkpoint:result.checkpoint,rawDigest:run.raw_digest,canonicalDigest:null,reason:null});
   if(run.phase==='raw'){need(result.kind==='verified'&&digest(result.rawStateDigest),'raw result');return save(run,p.id,{state:'working',phase:'canonical',checkpoint:null,rawDigest:result.rawStateDigest,canonicalDigest:null,reason:null});}
   if(result.kind!=='verified'||result.rootId!==run.root_id||result.inventoryId!==run.inventory_id||result.sourceRevision!==String(run.source_revision)||result.stateDigest!==run.declared_state_digest)return hold(run,p.id,'audit-canonical-result-conflict');
   return save(run,p.id,{state:'fingerprints-ready',phase:'canonical',checkpoint:null,rawDigest:run.raw_digest,canonicalDigest:result.stateDigest,reason:null});
  }
 });
}
