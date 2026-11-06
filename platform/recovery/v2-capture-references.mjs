import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {artifactIdentity,privateIdentity} from '../artifacts/identity.mjs';
import {verifyObject,persistObject,hashJson} from './inventory.mjs';
import {publicationPin} from './export.mjs';
import {objectRow} from './schema.mjs';
import {RECOVERY_V2_LIMITS} from './v2-codec.mjs';

const referenceTables=['app_private_artifacts','app_artifact_publications','manifest_catalog'];
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function need(condition,message){if(!condition)throw new TypeError(message);}
/** Reads one immutable captured page and verifies at most one referenced object
 * per continuation. It never consults live application rows after source seal.
 * Public verification alone permits the dedicated 4 MiB working-byte budget. */
export function createRecoveryV2ReferenceCapture({driver,artifacts,crypto,codec,v2Codec,source}){
 const read=async statement=>(await driver.batch([statement]))[0].rows;
 async function record(run,next,identities,publication=null){
  const child=[],checks=[],values=[];
  for(const identity of identities){
   const text=canonicalJson(identity),proof=await hashJson(crypto,['capture-v2-object',identity]);
   child.push((gate,v)=>sql(`INSERT INTO app_recovery_capture_objects(capture_id,object_key,identity_json,verified,verification_digest) SELECT ?,?,?,1,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,identity.key,text,proof,...v));
   checks.push('EXISTS(SELECT 1 FROM app_recovery_capture_objects WHERE capture_id=? AND object_key=? AND identity_json=? AND verified=1 AND verification_digest=?)');values.push(run.id,identity.key,text,proof);
  }
  if(publication){
   const {identity,pin,ordinal}=publication,text=canonicalJson(identity),key=canonicalJson([pin.identity.key]),proof=await hashJson(crypto,['capture-v2-publication',pin]);
   child.push((gate,v)=>sql(`INSERT INTO app_recovery_capture_pages(capture_id,scope,ordinal,kind,identity_json,item_count,first_cursor_json,last_cursor_json,result_digest) SELECT ?,'publications',?,'table',?,1,?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`,run.id,ordinal,text,key,key,proof,...v));
   checks.push("EXISTS(SELECT 1 FROM app_recovery_capture_pages WHERE capture_id=? AND scope='publications' AND ordinal=? AND identity_json=? AND result_digest=?)");values.push(run.id,ordinal,text,proof);
  }
  checks.push('(SELECT COUNT(*) FROM app_recovery_capture_objects WHERE capture_id=?)<=?','(SELECT COALESCE(SUM(json_extract(identity_json,\'$.size\')),0) FROM app_recovery_capture_objects WHERE capture_id=?)<=?');values.push(run.id,RECOVERY_V2_LIMITS.objects,run.id,RECOVERY_V2_LIMITS.totalBytes);
  return source.advance(run,next,{state:'verifying',sourceGuard:false,child,requiredSql:checks.join(' AND '),requiredValues:values});
 }
 async function step(run){
  need(run.state==='verifying','Reference capture requires sealed source pages.');
  const checkpoint=JSON.parse(run.checkpoint_json);need(checkpoint.phase==='references','Invalid reference capture phase.');
  if(checkpoint.tables.some((t,i)=>t.name.startsWith('earn_recovered_')&&checkpoint.tableCounts[i]>0))return source.hold(run,'private-source-is-public-recovery');
  const name=referenceTables[checkpoint.referenceTable];
  if(!name)return source.advance(run,{...checkpoint,phase:'indexes',indexTask:0},{state:'indexing',sourceGuard:false});
  const tableIndex=checkpoint.tables.findIndex(t=>t.name===name),table=checkpoint.tables[tableIndex];need(table,'Missing captured reference table.');
  if(checkpoint.referencePage>=checkpoint.tablePages[tableIndex])return source.advance(run,{...checkpoint,referenceTable:checkpoint.referenceTable+1,referencePage:0,referenceItem:0,referencePart:0},{state:'verifying',sourceGuard:false});
  const metadata=await read(sql("SELECT identity_json,item_count FROM app_recovery_capture_pages WHERE capture_id=? AND scope=? AND ordinal=? AND kind='rows'",run.id,'rows:'+name,checkpoint.referencePage));need(metadata.length===1,'Missing captured reference page.');
  const identity=privateIdentity(JSON.parse(metadata[0].identity_json)),stored=await verifyObject(artifacts,identity,crypto);if(stored.kind!=='verified')return {kind:'conflict',code:stored.reason};
  const page=await v2Codec.verifyRows(stored.bytes,identity);need(page.table===name&&page.index===checkpoint.referencePage&&same(page.columns,table.columns)&&page.hasRowid===table.hasRowid&&page.rows.length===metadata[0].item_count,'Captured reference page identity mismatch.');
  let row,reference,part=checkpoint.referencePart??0,item=checkpoint.referenceItem;
  while(item<page.rows.length){
   row=objectRow(table,page.rows[item]);
   if(name==='app_private_artifacts'){reference=privateIdentity({key:row.object_key,byteDigest:row.byte_digest,size:row.size,semanticDigest:row.semantic_digest,visibility:'private',contentType:row.content_type});break;}
   if(name==='manifest_catalog'){need(row.kind==='earn-archive-v1','Unknown public catalog kind.');reference=artifactIdentity({key:row.object_key,byteDigest:row.byte_digest,size:row.size_bytes,semanticDigest:null,visibility:'public',contentType:'application/json'});break;}
   const chunks=JSON.parse(row.staging_json);need(Array.isArray(chunks)&&chunks.length<=32,'Invalid bounded publication staging chunks.');
   if(part<chunks.length){reference=privateIdentity(chunks[part]);break;}item++;part=0;
  }
  if(!reference)return source.advance(run,{...checkpoint,referencePage:checkpoint.referencePage+1,referenceItem:0,referencePart:0},{state:'verifying',sourceGuard:false});
  const next={...checkpoint,referenceItem:name==='app_artifact_publications'?item:item+1,referencePart:name==='app_artifact_publications'?part+1:0};
  const object=await verifyObject(artifacts,reference,crypto);if(object.kind!=='verified')return {kind:'conflict',code:object.reason};
  if(name!=='manifest_catalog')return record(run,next,[reference]);
  const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(object.bytes)),verified=await codec.verify(object.bytes,{semanticDigest:bundle.sha256,byteDigest:reference.byteDigest}),pin=await publicationPin(verified,codec);
  need(pin.identity.key===reference.key&&pin.identity.byteDigest===reference.byteDigest&&pin.identity.size===reference.size,'Public capture identity mismatch.');
  const bytes=utf8(canonicalJson(pin)),byteDigest=await crypto.sha256(bytes),pinIdentity=privateIdentity({key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'}),saved=await persistObject(artifacts,pinIdentity,bytes,crypto);
  if(saved.kind!=='verified')return {kind:'conflict',code:saved.reason};
  next.publicationCount=(checkpoint.publicationCount??0)+1;return record(run,next,[pin.identity,pinIdentity],{identity:pinIdentity,pin,ordinal:checkpoint.publicationCount??0});
 }
 return Object.freeze({async step(run){try{return await step(run);}catch(error){return source.hold(run,'capture-reference-invalid:'+error.message);}}});
}
