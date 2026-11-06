import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {persistObject,hashJson} from './inventory.mjs';
import {RECOVERY_V2_LIMITS} from './v2-codec.mjs';
import {readRecoveryV2SourceMetadata,recoveryV2SourceGuardSql,checkRecoveryV2SourceGuard,recoveryV2SchemaFence} from './v2-schema.mjs';
import {planRecoveryV2Rows,materializeRecoveryV2Rows} from './v2-planning.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
function need(c,message){if(!c)throw new TypeError(message);}
const stateFence=`EXISTS(SELECT 1 FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1 AND r.generation=? AND r.mode IN ('live','private') AND r.status IN ('live','ready') AND r.write_nonce IS NULL AND w.revision=?)`;
const fence=stateFence+` AND EXISTS(SELECT 1 FROM app_recovery_captures captured WHERE captured.id=? AND ${recoveryV2SchemaFence('captured.descriptor_json')})`;
const sourceValues=(descriptor,captureId)=>[descriptor.sourceGeneration,descriptor.sourceWatermark,captureId];
/** Internal source-data phase. It never returns a ready recovery pin. Further
 * bounded object verification/index construction must consume the sealed pages. */
export function createRecoveryV2CaptureSource({driver,artifacts,crypto,clock,schema,v2Codec}){
 schema=clone(schema);
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function load(captureId){const [rows]=await read([sql('SELECT * FROM app_recovery_captures WHERE id=?',captureId)]);return rows[0]??null;}
 function outcome(run,kind='progress'){return run.state==='held'?{kind:'held',captureId:run.id,revision:run.revision,reason:run.reason}:{kind,captureId:run.id,revision:run.revision,phase:run.state};}
 async function hold(run,reason){await driver.batch([sql("UPDATE app_recovery_captures SET state='held',reason=?,revision=revision+1,updated_ms=? WHERE id=? AND revision=? AND state<>'ready'",reason,clock.nowMs(),run.id,run.revision)]);return outcome(await load(run.id));}
 async function advance(run,next,{state='reading',child=[],requiredSql='1',requiredValues=[],sourceGuard=true}={}){
  const descriptor=JSON.parse(run.descriptor_json),gate=`EXISTS(SELECT 1 FROM app_recovery_captures WHERE id=? AND state=? AND revision=?)${sourceGuard?' AND '+fence:''}`,values=[run.id,run.state,run.revision,...(sourceGuard?sourceValues(descriptor,run.id):[])],text=canonicalJson(next);
  need(utf8(text).length<=65536,'V2 capture checkpoint bound.');
  const mutations=child.map(make=>make(gate,values));mutations.push(sql(`UPDATE app_recovery_captures SET checkpoint_json=?,state=?,revision=revision+1,updated_ms=? WHERE id=? AND revision=? AND state=? AND ${requiredSql}${sourceGuard?' AND '+fence:''}`,text,state,clock.nowMs(),run.id,run.revision,run.state,...requiredValues,...(sourceGuard?sourceValues(descriptor,run.id):[])));
  try{await driver.batch(mutations);}catch(error){const latest=await load(run.id);if(latest?.revision>run.revision)return outcome(latest,'replayed');return {kind:'conflict',code:'capture-write-unknown'};}
  const latest=await load(run.id);if(latest?.revision>run.revision)return outcome(latest);
  if(sourceGuard){try{checkRecoveryV2SourceGuard((await read([sql(recoveryV2SourceGuardSql)]))[0],descriptor);const [matching]=await read([sql(`SELECT id FROM app_recovery_captures captured WHERE captured.id=? AND ${recoveryV2SchemaFence('captured.descriptor_json')}`,run.id)]);if(matching.length!==1)throw Error('Schema changed.');}catch{return hold(run,'capture-source-changed');}}
  return {kind:'conflict',code:'capture-write-conflict'};
 }
 async function start(input){
  const request=clone(input);need(Object.keys(request).length===2&&id(request.captureId)&&/^[a-f0-9]{40}$/.test(request.sourceCommit),'Invalid v2 capture start.');const old=await load(request.captureId);if(old)return old.source_commit===request.sourceCommit?outcome(old,'replayed'):{kind:'conflict',code:'capture-identity-conflict'};
  let descriptor;try{descriptor=await readRecoveryV2SourceMetadata(driver,{schema,crypto});}catch(error){return {kind:'conflict',code:'capture-source-unavailable:'+error.message};}
  const now=clock.nowMs();need(Number.isSafeInteger(now)&&now>=0,'Invalid v2 capture clock.');const checkpoint={phase:'schema',schemaCursor:0,tables:[],tableIndex:0,pageIndex:0,after:null,tableCounts:[],tablePages:[]};
  let unknown=false;try{await driver.batch([sql(`WITH candidate AS (SELECT ? descriptor) INSERT INTO app_recovery_captures(id,source_generation,source_watermark,schema_fingerprint,source_commit,created_ms,updated_ms,state,revision,descriptor_json,checkpoint_json,root_json,root_digest,reason)
   SELECT ?,?,?,?,?,?,?,'reading',0,descriptor,?,NULL,NULL,NULL FROM candidate WHERE ${stateFence} AND ${recoveryV2SchemaFence('candidate.descriptor')} ON CONFLICT(id) DO NOTHING`,canonicalJson(descriptor),request.captureId,descriptor.sourceGeneration,descriptor.sourceWatermark,schema.fingerprint,request.sourceCommit,now,now,canonicalJson(checkpoint),descriptor.sourceGeneration,descriptor.sourceWatermark)]);}catch{unknown=true;}
  const saved=await load(request.captureId);return saved?saved.source_commit===request.sourceCommit?outcome(saved,unknown?'replayed':'started'):{kind:'conflict',code:'capture-identity-conflict'}:{kind:'conflict',code:unknown?'capture-start-unknown':'capture-source-changed'};
 }
 async function step(input){
  const request=clone(input);need(Object.keys(request).length===2&&id(request.captureId)&&Number.isSafeInteger(request.expectedRevision)&&request.expectedRevision>=0,'Invalid v2 capture continuation.');const run=await load(request.captureId);if(!run)return {kind:'conflict',code:'capture-not-started'};
  if(run.revision!==request.expectedRevision)return run.revision>request.expectedRevision?outcome(run,'replayed'):{kind:'conflict',code:'capture-revision-conflict'};
  if(run.state!=='reading')return outcome(run,'replayed');const descriptor=JSON.parse(run.descriptor_json),checkpoint=JSON.parse(run.checkpoint_json);
  if(checkpoint.phase==='schema'){
   const names=descriptor.tableNames.slice(checkpoint.schemaCursor,checkpoint.schemaCursor+16),queries=names.map(name=>sql('SELECT name,type,pk FROM pragma_table_info(?) ORDER BY cid',name)),rows=await read([sql(recoveryV2SourceGuardSql),...queries,sql(recoveryV2SourceGuardSql)]);
   try{checkRecoveryV2SourceGuard(rows[0],descriptor);checkRecoveryV2SourceGuard(rows.at(-1),descriptor);}catch{return hold(run,'capture-source-changed');}
   for(const [n,name]of names.entries()){const fields=rows[n+1];if(!fields.length||fields.length>64||fields.some(f=>!['TEXT','INTEGER'].includes(f.type)||typeof f.name!=='string'||!/^[a-z][a-z0-9_]*$/.test(f.name)))return hold(run,'capture-schema-column-unavailable');
    // All trusted installed business tables currently have rowids. Detect the
    // rare WITHOUT ROWID case from its bounded definition in the same schema.
    checkpoint.tables.push({name,columns:fields.map(f=>f.name),primaryKey:fields.filter(f=>f.pk>0).sort((a,b)=>a.pk-b.pk).map(f=>f.name),hasRowid:true});checkpoint.tableCounts.push(0);checkpoint.tablePages.push(0);
   }
   // Read only the selected definitions; still bounded and fenced at commit.
   if(names.length){const [definitions]=await read([sql('SELECT name,CASE WHEN length(CAST(sql AS BLOB))<=16384 THEN sql ELSE NULL END sql FROM sqlite_schema WHERE type=\'table\' AND name IN (SELECT value FROM json_each(?))',canonicalJson(names))]);for(const table of checkpoint.tables.slice(-names.length)){const definition=definitions.find(d=>d.name===table.name);if(!definition||typeof definition.sql!=='string'||utf8(definition.sql).length>16384)return hold(run,'capture-schema-definition-unavailable');table.hasRowid=!/\bWITHOUT\s+ROWID\b/i.test(definition.sql);}}
   checkpoint.schemaCursor+=names.length;if(checkpoint.schemaCursor===descriptor.tableNames.length)checkpoint.phase='rows';return advance(run,checkpoint);
  }
  need(checkpoint.phase==='rows','Invalid v2 source phase.');
  const table=checkpoint.tables[checkpoint.tableIndex];if(!table)return advance(run,{...checkpoint,phase:'references',referenceTable:0,referencePage:0,referenceItem:0},{state:'verifying'});
  const plan=planRecoveryV2Rows(table,{index:checkpoint.pageIndex,after:checkpoint.after}),rows=await read([sql(recoveryV2SourceGuardSql),plan.statement,sql(recoveryV2SourceGuardSql)]);let page;
  try{checkRecoveryV2SourceGuard(rows[0],descriptor);checkRecoveryV2SourceGuard(rows[2],descriptor);}catch{return hold(run,'capture-source-changed');}
  try{page=materializeRecoveryV2Rows(plan,rows[1]);}catch{return hold(run,'capture-row-bound-or-invalid');}
  if(!page.value){checkpoint.tableIndex++;checkpoint.pageIndex=0;checkpoint.after=null;return advance(run,checkpoint);}
  const n=page.value.rows.length;if(checkpoint.tableCounts[checkpoint.tableIndex]+n>RECOVERY_V2_LIMITS.tableRows)return hold(run,'capture-table-row-bound');
  const object=await v2Codec.encodeRows(page.value),stored=await persistObject(artifacts,object.identity,object.bytes,crypto);if(stored.kind!=='verified')return {kind:'conflict',code:stored.reason};
  const scope='rows:'+table.name,ordinal=checkpoint.pageIndex,identityJson=canonicalJson(object.identity),first=canonicalJson(page.first),last=canonicalJson(page.last),proof=await hashJson(crypto,['capture-v2-page',run.id,scope,ordinal,object.identity,n,page.first,page.last]),verified=await hashJson(crypto,['capture-v2-object',object.identity]);
  checkpoint.tableCounts[checkpoint.tableIndex]+=n;checkpoint.tablePages[checkpoint.tableIndex]++;checkpoint.pageIndex++;checkpoint.after=page.last;if(page.exhausted){checkpoint.tableIndex++;checkpoint.pageIndex=0;checkpoint.after=null;}
  return advance(run,checkpoint,{child:[
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_pages(capture_id,scope,ordinal,kind,identity_json,item_count,first_cursor_json,last_cursor_json,result_digest) SELECT ?,?,?,'rows',?,?,?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,scope,ordinal,identityJson,n,first,last,proof,...v),
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_objects(capture_id,object_key,identity_json,verified,verification_digest) SELECT ?,?,?,1,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,object.identity.key,identityJson,verified,...v),
  ],requiredSql:`EXISTS(SELECT 1 FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal=? AND identity_json=? AND item_count=? AND result_digest=?) AND EXISTS(SELECT 1 FROM app_recovery_capture_objects WHERE capture_id=? AND object_key=? AND identity_json=? AND verified=1 AND verification_digest=?) AND (SELECT COUNT(*) FROM app_recovery_capture_objects WHERE capture_id=?)<=? AND (SELECT COALESCE(SUM(json_extract(identity_json,'$.size')),0) FROM app_recovery_capture_objects WHERE capture_id=?)<=?`,requiredValues:[run.id,scope,ordinal,identityJson,n,proof,run.id,object.identity.key,identityJson,verified,run.id,RECOVERY_V2_LIMITS.objects,run.id,RECOVERY_V2_LIMITS.totalBytes]});
 }
 return Object.freeze({start,step,load,advance,hold});
}
