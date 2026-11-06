import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {legacyAuditSourceFenceSql} from './legacy-audit-repository.mjs';
import {committedCollectionSourceSealSql} from './source-seal-guard.mjs';
import {createLegacySourceRelationAudit} from './legacy-source-relation.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),size=value=>utf8(canonicalJson(value)).length;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value),digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),integer=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const need=(ok,message)=>{if(!ok)throw new TypeError('Legacy relation '+message);};
const bounded=(expression,bytes)=>`CASE WHEN length(CAST(${expression} AS BLOB))<=${bytes} THEN ${expression} ELSE NULL END`;
const scope="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-import' AND enabled=1)";
const lineage=`EXISTS(SELECT 1 FROM app_collection_source_seals s WHERE s.id=p.root_id AND s.inventory_id=p.inventory_id AND s.source_revision=CAST(p.source_revision AS TEXT) AND s.declared_state_digest=p.canonical_digest AND ${committedCollectionSourceSealSql('s')})`;
const parentFence=`p.state='fingerprints-ready' AND p.canonical_digest=p.declared_state_digest AND ${legacyAuditSourceFenceSql('p')} AND ${lineage}`;
const parentColumns=`${bounded('p.id',128)} fingerprint_audit_id,${bounded('p.inventory_id',128)} inventory_id,${bounded('p.root_id',64)} root_id,p.source_revision,${bounded('p.raw_digest',64)} raw_digest,${bounded('p.canonical_digest',64)} canonical_digest,p.state parent_state,${bounded("json_extract(p.descriptor_json,'$.sourceGeneration')",256)} source_generation,json_extract(p.descriptor_json,'$.sourceWatermark') source_watermark`;
const relationColumns=`a.id,a.parent_audit_id,a.operator,a.state,a.revision,a.checkpoint_json,a.result_json,${bounded('a.last_nonce',128)} last_nonce,${bounded('a.reason',512)} reason,a.created_ms,a.updated_ms`;
const validParent=row=>row&&id(row.fingerprint_audit_id)&&id(row.inventory_id)&&digest(row.root_id)&&integer(row.source_revision)&&digest(row.raw_digest)&&digest(row.canonical_digest)&&typeof row.source_generation==='string'&&row.source_generation.length<=256&&integer(row.source_watermark);
const validRun=row=>validParent(row)&&id(row.id)&&id(row.operator)&&row.parent_audit_id===row.fingerprint_audit_id&&integer(row.revision)&&id(row.last_nonce)&&['working','ready','held'].includes(row.state)&&integer(row.created_ms)&&integer(row.updated_ms)&&row.updated_ms>=row.created_ms;
const conflict=code=>Object.freeze({kind:'conflict',code});
function matches(result,row){return result?.kind==='verified'&&result.rootId===row.root_id&&result.inventoryId===row.inventory_id&&result.declaredStateDigest===row.canonical_digest&&result.pin?.id===row.inventory_id&&result.pin.revision===row.source_revision&&result.pin.generation===row.source_generation&&result.pin.watermark===row.source_watermark&&result.verification==='source-components-equal-legacy-json'&&digest(result.relationDigest)&&result.canonicalDigestVerified===false&&result.rawByteDigestVerified===false&&result.economicsVerified===false&&result.adoptionAuthorized===false&&result.executable===false;}
/** Private durable preparatory audit, not collection/economic activation. The
 * caller selects a ready parent; every prefix and digest comes from SQL/core. */
export function createLegacyRelationRepository({driver,crypto,clock,ids,onMeasure=()=>{}}){
 const principal=value=>{need(exact(value,['kind','id'])&&value.kind==='operator'&&id(value.id),'operator principal');return clone(value);};
 const now=()=>{const value=clock.nowMs();need(integer(value)&&value<=8640000000000000,'clock');return value;};
 const nonce=()=>{const value=ids.next();need(id(value),'attempt nonce');return value;};
 function context(){
  const m={sql:0,batches:0,maxBatchBytes:0,returnedBytes:0,coreWorkingBytes:0,controlBytes:0,resultBytes:0,workingBytes:0};let core=false;
  const bound=extra=>{m.workingBytes=Math.max(m.workingBytes,m.coreWorkingBytes+m.controlBytes*3+16384,(m.controlBytes+m.resultBytes+extra)*3+16384);need(m.workingBytes<=1048576,'working-byte-bound');};
  const measured={...driver,async batch(statements){const batch=measureBatch(statements);m.sql+=batch.statements;m.batches++;m.maxBatchBytes=Math.max(m.maxBatchBytes,batch.batchBytes);need(m.sql<=64,'query-bound');if(!core)bound(batch.batchBytes);const results=await driver.batch(statements);need(results.length===statements.length&&results.every(r=>Array.isArray(r.rows)),'driver results');const bytes=size(results);m.returnedBytes+=bytes;if(!core)bound(batch.batchBytes+bytes);return results;}};
  return {m,driver:measured,read:async statements=>(await measured.batch(statements)).map(r=>r.rows),control(row){m.controlBytes=Math.max(m.controlBytes,size(row));bound(0);},result(value){m.resultBytes=size(value);bound(0);},async compute(input){core=true;let result;try{result=await createLegacySourceRelationAudit({driver:measured,crypto}).step(input);}finally{core=false;}m.coreWorkingBytes=result.metrics.maxWorkingBytes;bound(0);return result;},report(){onMeasure(Object.freeze({...m}));}};
 }
 async function load(ctx,auditId,operator){const [rows]=await ctx.read([sql(`SELECT ${relationColumns},${parentColumns},CASE WHEN ${parentFence} THEN 1 ELSE 0 END source_current FROM app_collection_legacy_relations a JOIN app_collection_legacy_audits p ON p.id=a.parent_audit_id AND p.operator=a.operator WHERE a.id=? AND a.operator=? AND ${scope}`,auditId,operator,operator)]);need(rows.length<=1&&size(rows)<=32768,'bounded control read');if(rows[0]){need(validRun(rows[0]),'invalid retained control');ctx.control(rows[0]);}return rows[0]??null;}
 function outcome(row,kind='progress'){
  if(!row)return conflict('relation-not-found-or-scope');if(row.state==='held')return Object.freeze({kind:'held',auditId:row.id,revision:row.revision,reason:row.reason});if(!row.source_current)return Object.freeze({kind:'held',auditId:row.id,revision:row.revision,reason:'relation-parent-source-changed'});
  if(row.state!=='ready')return Object.freeze({kind,auditId:row.id,fingerprintAuditId:row.parent_audit_id,revision:row.revision});
  const result=JSON.parse(row.result_json);if(!matches(result,row))return Object.freeze({kind:'held',auditId:row.id,revision:row.revision,reason:'relation-retained-result-invalid'});
  return Object.freeze({kind:'relation-ready',auditId:row.id,fingerprintAuditId:row.parent_audit_id,revision:row.revision,inventoryId:row.inventory_id,rootId:row.root_id,rawStateDigest:row.raw_digest,canonicalStateDigest:row.canonical_digest,relationDigest:result.relationDigest,sourceRelation:true,economics:false,adoption:false,executable:false});
 }
 async function save(ctx,row,operator,next){
  const checkpoint=next.checkpoint===null?null:canonicalJson(next.checkpoint),result=next.result===null?null:canonicalJson(next.result);need(checkpoint===null||utf8(checkpoint).length<=8192,'checkpoint bound');need(result===null||utf8(result).length<=8192,'result bound');const attempt=nonce(),time=now();if(attempt===row.last_nonce)return conflict('relation-nonce-reused');ctx.result(next);let unknown=false,changed=0;
  try{const written=await ctx.driver.batch([sql(`UPDATE app_collection_legacy_relations AS a SET state=?,checkpoint_json=?,result_json=?,reason=?,revision=revision+1,last_nonce=?,updated_ms=? WHERE a.id=? AND a.operator=? AND a.parent_audit_id=? AND a.state='working' AND a.revision=? AND a.checkpoint_json IS ? AND a.result_json IS ? AND a.last_nonce=? AND ${scope} AND EXISTS(SELECT 1 FROM app_collection_legacy_audits p WHERE p.id=a.parent_audit_id AND p.operator=a.operator AND ${parentFence})`,next.state,checkpoint,result,next.reason,attempt,time,row.id,operator,row.parent_audit_id,row.revision,row.checkpoint_json,row.result_json,row.last_nonce,operator)]);changed=written[0]?.changes??0;}catch{unknown=true;}
  const latest=await load(ctx,row.id,operator);if(!latest)return conflict('relation-not-found-or-scope');if(latest.revision>row.revision)return outcome(latest,latest.last_nonce===attempt&&!unknown&&changed>0?'progress':'replayed');if(!latest.source_current)return outcome(latest);return conflict(unknown?'relation-write-unknown':'relation-write-conflict');
 }
 return Object.freeze({
  async start(who,input){const p=principal(who),request=clone(input);need(exact(request,['auditId','fingerprintAuditId'])&&id(request.auditId)&&id(request.fingerprintAuditId),'start fields');const ctx=context();try{
   const old=await load(ctx,request.auditId,p.id);if(old)return old.parent_audit_id===request.fingerprintAuditId?outcome(old,'replayed'):conflict('relation-identity-conflict');
   const [parents]=await ctx.read([sql(`SELECT ${parentColumns},CASE WHEN ${parentFence} THEN 1 ELSE 0 END source_current FROM app_collection_legacy_audits p WHERE p.id=? AND p.operator=? AND ${scope}`,request.fingerprintAuditId,p.id,p.id)]);if(parents.length!==1||!validParent(parents[0])||!parents[0].source_current)return conflict('relation-parent-unavailable');ctx.control(parents[0]);const attempt=nonce(),time=now();let unknown=false,changed=0;
   try{const written=await ctx.driver.batch([sql(`INSERT INTO app_collection_legacy_relations(id,parent_audit_id,operator,state,revision,checkpoint_json,result_json,last_nonce,reason,created_ms,updated_ms) SELECT ?,p.id,p.operator,'working',0,NULL,NULL,?,NULL,?,? FROM app_collection_legacy_audits p WHERE p.id=? AND p.operator=? AND ${scope} AND ${parentFence} ON CONFLICT DO NOTHING`,request.auditId,attempt,time,time,request.fingerprintAuditId,p.id,p.id)]);changed=written[0]?.changes??0;}catch{unknown=true;}
   const saved=await load(ctx,request.auditId,p.id);if(saved)return saved.parent_audit_id===request.fingerprintAuditId?outcome(saved,!unknown&&changed>0&&saved.last_nonce===attempt?'started':'replayed'):conflict('relation-identity-conflict');return conflict(unknown?'relation-start-unknown':'relation-start-conflict');
  }finally{ctx.report();}},
  async step(who,input){const p=principal(who),request=clone(input);need(exact(request,['auditId','expectedRevision'])&&id(request.auditId)&&integer(request.expectedRevision),'step fields');const ctx=context();try{
   const row=await load(ctx,request.auditId,p.id);if(!row)return conflict('relation-not-found-or-scope');if(row.revision!==request.expectedRevision)return row.revision>request.expectedRevision?outcome(row,'replayed'):conflict('relation-revision-conflict');if(row.state!=='working'||!row.source_current)return outcome(row);
   const result=await ctx.compute({inventoryId:row.inventory_id,rootId:row.root_id,checkpoint:row.checkpoint_json===null?null:JSON.parse(row.checkpoint_json)});
   if(result.kind==='held')return await save(ctx,row,p.id,{state:'held',checkpoint:row.checkpoint_json===null?null:JSON.parse(row.checkpoint_json),result:null,reason:result.reason});
   if(result.kind==='continue')return await save(ctx,row,p.id,{state:'working',checkpoint:result.checkpoint,result:null,reason:null});
   if(!matches(result,row))return await save(ctx,row,p.id,{state:'held',checkpoint:row.checkpoint_json===null?null:JSON.parse(row.checkpoint_json),result:null,reason:'relation-result-parent-conflict'});
   return await save(ctx,row,p.id,{state:'ready',checkpoint:null,result,reason:null});
  }finally{ctx.report();}}
 });
}
