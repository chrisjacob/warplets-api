import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {persistObject,verifyObject,hashJson} from './inventory.mjs';
import {RECOVERY_V2_LIMITS,recoveryV2IndexSummary} from './v2-codec.mjs';
const fanout=16;
function need(c,message){if(!c)throw new TypeError(message);}
class PendingObject extends Error {}
const key=n=>String(n).padStart(10,'0');
/** Bounded index construction over the durable, immutable capture ledger. Each
 * step writes one content-addressed node; source application rows are never
 * reopened. All nodes are re-read one at a time before the independent root. */
export function createRecoveryV2IndexCapture({driver,artifacts,crypto,clock,v2Codec,source}){
 const read=async statement=>(await driver.batch([statement]))[0].rows;
 async function persist(run,next,{scope,ordinal,kind,value,count,first,last}){
  let object;
  if(kind==='index')object=await v2Codec.encodeIndex(value);
  else{const bytes=utf8(canonicalJson(value)),byteDigest=await crypto.sha256(bytes);object={bytes,identity:privateIdentity({key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'})};}
  const stored=await persistObject(artifacts,object.identity,object.bytes,crypto);if(stored.kind!=='verified')return {kind:'conflict',code:stored.reason};
  const identityJson=canonicalJson(object.identity),proof=await hashJson(crypto,['capture-v2-metadata',scope,ordinal,object.identity,count,first,last]),verified=await hashJson(crypto,['capture-v2-object',object.identity]);
  return source.advance(run,next,{state:'indexing',sourceGuard:false,child:[
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_pages(capture_id,scope,ordinal,kind,identity_json,item_count,first_cursor_json,last_cursor_json,result_digest) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,scope,ordinal,kind,identityJson,count,canonicalJson(first),canonicalJson(last),proof,...v),
   (gate,v)=>sql(`INSERT INTO app_recovery_capture_objects(capture_id,object_key,identity_json,verified,verification_digest) SELECT ?,?,?,1,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,object.identity.key,identityJson,verified,...v),
  ],requiredSql:`EXISTS(SELECT 1 FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal=? AND kind=? AND identity_json=? AND item_count=? AND result_digest=?) AND EXISTS(SELECT 1 FROM app_recovery_capture_objects WHERE capture_id=? AND object_key=? AND identity_json=? AND verified=1 AND verification_digest=?) AND (SELECT COUNT(*) FROM app_recovery_capture_objects WHERE capture_id=?)<=? AND (SELECT COALESCE(SUM(json_extract(identity_json,'$.size')),0) FROM app_recovery_capture_objects WHERE capture_id=?)<=?`,requiredValues:[run.id,scope,ordinal,kind,identityJson,count,proof,run.id,object.identity.key,identityJson,verified,run.id,RECOVERY_V2_LIMITS.objects,run.id,RECOVERY_V2_LIMITS.totalBytes]});
 }
 async function jsonRecord(row){const identity=privateIdentity(JSON.parse(row.identity_json)),object=await verifyObject(artifacts,identity,crypto);if(object.kind!=='verified')throw new PendingObject(object.reason);const text=new TextDecoder('utf-8',{fatal:true}).decode(object.bytes),value=JSON.parse(text);need(canonicalJson(value)===text,'Captured metadata is not canonical.');return value;}
 async function leaves(run,checkpoint,work){
  if(work.kind==='objects'){
   const rows=await read(sql(`SELECT o.object_key,o.identity_json FROM app_recovery_capture_objects o WHERE o.capture_id=? AND o.object_key>? AND NOT EXISTS(SELECT 1 FROM app_recovery_capture_pages p WHERE p.capture_id=o.capture_id AND p.kind='index' AND json_extract(p.identity_json,'$.key')=o.object_key) ORDER BY o.object_key LIMIT ?`,run.id,work.cursor??'',fanout));
   return {entries:rows.map(row=>({key:row.object_key,value:JSON.parse(row.identity_json)})),cursor:rows.at(-1)?.object_key??work.cursor};
  }
  if(work.kind==='publications'){
   const rows=await read(sql("SELECT identity_json FROM app_recovery_capture_pages WHERE capture_id=? AND scope='publications' AND json_extract(first_cursor_json,'$[0]')>? ORDER BY json_extract(first_cursor_json,'$[0]') LIMIT ?",run.id,work.cursor??'',fanout)),entries=[];
   for(const row of rows){const value=await jsonRecord(row);entries.push({key:value.identity.key,value});}
   return {entries,cursor:entries.at(-1)?.key??work.cursor};
  }
  const scope=work.kind==='table-pages'?'rows:'+checkpoint.tables[checkpoint.indexTask].name:work.kind;
  const rows=await read(sql(`SELECT p.*,(SELECT previous.last_cursor_json FROM app_recovery_capture_pages previous WHERE previous.capture_id=p.capture_id AND previous.scope=p.scope AND previous.ordinal=p.ordinal-1) prior_cursor FROM app_recovery_capture_pages p WHERE p.capture_id=? AND p.scope=? AND p.ordinal>=? ORDER BY p.ordinal LIMIT ?`,run.id,scope,work.cursor,fanout));
  need(rows.every((r,i)=>r.ordinal===work.cursor+i),'Captured metadata ordinal gap.');
  const entries=[];
  for(const row of rows){
   if(work.kind==='table-pages')entries.push({key:key(row.ordinal),value:{identity:JSON.parse(row.identity_json),index:row.ordinal,rowCount:row.item_count,after:row.ordinal===0?null:JSON.parse(row.prior_cursor),last:JSON.parse(row.last_cursor_json)}});
   else{const value=await jsonRecord(row);if(work.kind==='tables')await v2Codec.verifyTableDescriptor(value);entries.push({key:work.kind==='tables'?value.name:value.identity.key,value});}
  }
  return {entries,cursor:work.cursor+rows.length};
 }
 async function tree(run,checkpoint,kind,label){
  const work=checkpoint.indexWork??{kind,label,level:0,cursor:['objects','publications'].includes(kind)?'':0,nodes:0};need(work.kind===kind&&work.label===label,'Capture index task changed.');
  let entries,cursor;
  if(work.level===0)({entries,cursor}=await leaves(run,checkpoint,work));
  else{
   const rows=await read(sql('SELECT * FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal>=? ORDER BY ordinal LIMIT ?',run.id,'index:'+label+':'+(work.level-1),work.cursor,fanout));need(rows.every((r,i)=>r.ordinal===work.cursor+i),'Captured index ordinal gap.');
   entries=rows.map(r=>({first:JSON.parse(r.first_cursor_json)[0],last:JSON.parse(r.last_cursor_json)[0],count:r.item_count,identity:JSON.parse(r.identity_json)}));cursor=work.cursor+rows.length;
  }
  if(entries.length){
   const value={format:'10x.local.recovery.index.v2',kind,level:work.level,entries},summary=recoveryV2IndexSummary(value,{key:'private/'+'0'.repeat(64)+'.json',byteDigest:'0'.repeat(64),size:1,semanticDigest:null,visibility:'private',contentType:'application/json'});
   return {outcome:await persist(run,{...checkpoint,indexWork:{...work,cursor,nodes:work.nodes+1}},{scope:'index:'+label+':'+work.level,ordinal:work.nodes,kind:'index',value,count:summary.count,first:[summary.first],last:[summary.last]})};
  }
  if(work.nodes===0&&work.level===0)return {pointer:{identity:null,count:0}};
  if(work.nodes===1){const rows=await read(sql('SELECT identity_json,item_count FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal=0',run.id,'index:'+label+':'+work.level));need(rows.length===1,'Missing completed capture index.');return {pointer:{identity:JSON.parse(rows[0].identity_json),count:rows[0].item_count}};}
  need(work.nodes>1&&work.level+1<RECOVERY_V2_LIMITS.indexLevels,'Capture index depth bound.');return {outcome:await source.advance(run,{...checkpoint,indexWork:{...work,level:work.level+1,cursor:0,nodes:0}},{state:'indexing',sourceGuard:false})};
 }
 async function completeTree(run,checkpoint,kind,label,field){const result=await tree(run,checkpoint,kind,label);if(result.outcome)return result.outcome;const next={...checkpoint,[field]:result.pointer,indexTask:checkpoint.indexTask+1};delete next.indexWork;return source.advance(run,next,{state:'indexing',sourceGuard:false});}
 async function checkpointObject(run,checkpoint){
  const descriptor=JSON.parse(run.descriptor_json);
  // Full job/audit histories are already committed by their paged table roots.
  // V2 checkpoint deliberately references those roots, avoiding a second large
  // jobs array. Reconciliation still checks each audit row and economic ledger.
  const value={format:'10x.local.recovery.checkpoints.v2',sourceGeneration:descriptor.sourceGeneration,sourceRecovery:descriptor.sourceRecovery,tables:checkpoint.tablesPointer,sessionsRevoked:true,financialExecution:false};
  return persist(run,{...checkpoint,indexTask:checkpoint.indexTask+1},{scope:'checkpoints',ordinal:0,kind:'checkpoints',value,count:1,first:null,last:null});
 }
 async function step(run){
  need(run.state==='indexing','Capture indexes require sealed source.');const checkpoint=JSON.parse(run.checkpoint_json);
  if(checkpoint.phase==='verify-objects'){
   const rows=await read(sql('SELECT identity_json,object_key FROM app_recovery_capture_objects WHERE capture_id=? AND object_key>? ORDER BY object_key LIMIT 1',run.id,checkpoint.verifyAfter??''));
   if(!rows.length)return source.advance(run,{...checkpoint,phase:'root'},{state:'indexing',sourceGuard:false});
   const object=await verifyObject(artifacts,JSON.parse(rows[0].identity_json),crypto);if(object.kind!=='verified')return {kind:'conflict',code:object.reason};
   return source.advance(run,{...checkpoint,verifyAfter:rows[0].object_key,verifiedCount:(checkpoint.verifiedCount??0)+1},{state:'indexing',sourceGuard:false});
  }
  if(checkpoint.phase==='root')return {kind:'progress',captureId:run.id,revision:run.revision,phase:'indexing'};
  need(checkpoint.phase==='indexes','Invalid index capture phase.');const n=checkpoint.indexTask;
  if(n<checkpoint.tables.length){
   const table=checkpoint.tables[n],result=await tree(run,checkpoint,'table-pages','pages:'+table.name);if(result.outcome)return result.outcome;need(result.pointer.count===checkpoint.tablePages[n],'Captured table page count mismatch.');
   const value=await v2Codec.tableDescriptor({...table,rowCount:checkpoint.tableCounts[n],pages:result.pointer}),next={...checkpoint,indexTask:n+1};delete next.indexWork;
   return persist(run,next,{scope:'tables',ordinal:n,kind:'table',value,count:1,first:[table.name],last:[table.name]});
  }
  if(n===checkpoint.tables.length)return completeTree(run,checkpoint,'tables','tables','tablesPointer');
  if(n===checkpoint.tables.length+1)return completeTree(run,checkpoint,'publications','publications','publicationsPointer');
  if(n===checkpoint.tables.length+2)return checkpointObject(run,checkpoint);
  if(n===checkpoint.tables.length+3)return completeTree(run,checkpoint,'objects','objects','objectsPointer');
  return source.advance(run,{...checkpoint,phase:'verify-objects',verifyAfter:'',verifiedCount:0},{state:'indexing',sourceGuard:false});
 }
 async function finish(run){
  const checkpoint=JSON.parse(run.checkpoint_json);need(run.state==='indexing'&&checkpoint.phase==='root','Capture graph verification is incomplete.');
  const [totals,metadata]=await Promise.all([read(sql('SELECT COUNT(*) objects,COALESCE(SUM(json_extract(identity_json,\'$.size\')),0) bytes,SUM(CASE WHEN verified=1 THEN 0 ELSE 1 END) unverified FROM app_recovery_capture_objects WHERE capture_id=?',run.id)),read(sql("SELECT identity_json FROM app_recovery_capture_pages WHERE capture_id=? AND scope='checkpoints' AND ordinal=0",run.id))]);
  need(metadata.length===1&&totals[0].objects===checkpoint.verifiedCount&&totals[0].unverified===0,'Capture object graph verification incomplete.');const descriptor=JSON.parse(run.descriptor_json);
  const pinned=await v2Codec.encodeRoot({format:'10x.local.recovery.v2',mode:'private',createdMs:run.created_ms,sourceCommit:run.source_commit,schema:descriptor.schema,snapshot:{generation:run.source_generation,watermark:String(run.source_watermark)},tables:checkpoint.tablesPointer,objects:checkpoint.objectsPointer,publications:checkpoint.publicationsPointer,checkpoints:JSON.parse(metadata[0].identity_json),totals:{rows:checkpoint.tableCounts.reduce((a,b)=>a+b,0),objects:totals[0].objects,bytes:totals[0].bytes},authPolicy:'revoke-sessions-and-fence-leases'});
  try{await driver.batch([sql("UPDATE app_recovery_captures SET state='ready',root_json=?,root_digest=?,revision=revision+1,updated_ms=? WHERE id=? AND revision=? AND state='indexing' AND json_extract(checkpoint_json,'$.phase')='root' AND (SELECT COUNT(*) FROM app_recovery_capture_objects WHERE capture_id=?)=? AND NOT EXISTS(SELECT 1 FROM app_recovery_capture_objects WHERE capture_id=? AND verified<>1)",canonicalJson(pinned.value),pinned.digest,clock.nowMs(),run.id,run.revision,run.id,checkpoint.verifiedCount,run.id)]);}catch{}
  const saved=await source.load(run.id);return saved.state==='ready'&&saved.root_digest===pinned.digest?{kind:'captured',captureId:run.id,revision:saved.revision,...pinned}:{kind:'conflict',code:'capture-finish-unknown'};
 }
 return Object.freeze({async step(run){try{return await step(run);}catch(error){return error instanceof PendingObject?{kind:'conflict',code:error.message}:source.hold(run,'capture-index-invalid:'+error.message);}},finish});
}
