import {parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {BUSINESS_TABLES,AUTH_TABLES,quote,objectRow} from './schema.mjs';
import {hashJson,persistObject,verifyObject} from './inventory.mjs';
import {readRecoveryV2SourceMetadata} from './v2-schema.mjs';
import {createRecoveryV2RestoreDatabase} from './v2-restore-db.mjs';
import {createRecoveryV2IndexReader} from './v2-traversal.mjs';
import {fenceRow,readPinnedPublication} from './reconcile.mjs';
import {createRecoveryV2Reconciler} from './v2-reconcile.mjs';
import {createRecoveryV2FragmentCodec} from './v2-fragments.mjs';
import {createRecoveryV2FragmentRestore} from './v2-fragment-restore.mjs';
import {recoveryTableOrderIndices,recoveryTableOrderPosition} from './v2-table-order.mjs';
const clone=v=>JSON.parse(canonicalJson(v)),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function need(c,message){if(!c)throw new TypeError(message);}
const conflict=code=>({kind:'conflict',code});
class MissingObject extends Error {}
// Array position and each dependency index refer to the schema-pinned sorted
// BUSINESS_TABLES inventory. Older private checkpoints used a name-keyed map.
function parentIndices(value,count){
 need(Number.isSafeInteger(count)&&count>=0&&count<=BUSINESS_TABLES.length,'Private v2 parent graph count invalid.');
 if(value==null){need(count===0,'Private v2 parent graph missing.');return [];}
 let rows;
 if(Array.isArray(value)){need(value.length===count,'Private v2 parent graph length invalid.');rows=value;}
 else{
  need(value!==null&&typeof value==='object','Private v2 legacy parent graph invalid.');
  const names=Object.keys(value);need(names.length===count&&names.every(name=>BUSINESS_TABLES.slice(0,count).includes(name)),'Private v2 legacy parent graph names invalid.');
  rows=BUSINESS_TABLES.slice(0,count).map(name=>{const parents=value[name];need(Array.isArray(parents)&&parents.every(parent=>typeof parent==='string'&&BUSINESS_TABLES.includes(parent)),'Private v2 legacy parent dependency invalid.');return parents.map(parent=>BUSINESS_TABLES.indexOf(parent));});
 }
 return rows.map((parents,index)=>{need(Array.isArray(parents)&&parents.every(parent=>Number.isSafeInteger(parent)&&parent>=0&&parent<BUSINESS_TABLES.length&&parent!==index)&&new Set(parents).size===parents.length,'Private v2 parent dependency indices invalid.');return [...parents];});
}

/** Private continued importer and reconciler. No public runtime route or
 * financial execution capability is implied by this local composition. */
export function createRecoveryV2Restore({driver,artifacts,sourceArtifacts=artifacts,crypto,clock,ids,schema,v2Codec,codec,beaconVerifier,createDigest}){
 schema=clone(schema);const repository=createRecoveryV2RestoreDatabase({driver,clock,ids}),reader=createRecoveryV2IndexReader({artifacts:sourceArtifacts,crypto,v2Codec}),reconciler=createRecoveryV2Reconciler({driver,artifacts,crypto,v2Codec,codec,repository,beaconVerifier,createDigest});
 const fragmentCodec=createRecoveryV2FragmentCodec({crypto}),fragments=createRecoveryV2FragmentRestore({driver,artifacts,crypto,repository});
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function input(value){const captured=clone(value),bytes=utf8(canonicalJson(captured.root)),root=await v2Codec.verifyRoot(bytes,captured.pinnedDigest);need(same(root.schema,schema),'Private v2 schema differs from installed migrations.');return {root,id:captured.pinnedDigest,expectedRevision:captured.expectedRevision};}
 async function copied(identity,bytes=null){
  if(bytes===null){const object=await verifyObject(sourceArtifacts,identity,crypto);if(object.kind!=='verified')throw new MissingObject(object.reason);bytes=object.bytes;}
  const result=await persistObject(artifacts,identity,bytes,crypto);if(result.kind!=='verified')throw new MissingObject(result.reason);
  return {key:'object:'+identity.key,digest:identity.byteDigest,resultDigest:await hashJson(crypto,['v2-restored-object',identity]),rowCount:0,tableName:'object'};
 }
 async function walk(kind,pointer,cursor){const result=await reader.step({kind,pointer,cursor});if(result.kind==='pending')throw new MissingObject(result.reason);return result;}
 async function metadata(loaded,c){
  const parents=parentIndices(c.parents,c.tables.length),result=await walk('tables',c.root.tables,c.tableCursor),records=[];if(result.metadata)records.push(await copied(result.metadata.identity,result.metadata.bytes));
  const delta={tableCursor:result.cursor,parents};
  if(result.kind==='entry'){
   const table=await v2Codec.verifyTableDescriptor(result.value);need(table.name===BUSINESS_TABLES[c.tables.length],'Private v2 table inventory is missing, duplicated or unordered.');
   const [columns,relationships]=await read([sql('SELECT name,type,pk FROM pragma_table_info(?) ORDER BY cid',table.name),sql('SELECT "table" parent FROM pragma_foreign_key_list(?)',table.name)]),definition=c.descriptor.schemaInventory.find(r=>r.type==='table'&&r.name===table.name);
   need(definition&&columns.length>0&&columns.every(col=>['TEXT','INTEGER'].includes(col.type))&&same(columns.map(col=>col.name),table.columns)&&same(columns.filter(col=>col.pk>0).sort((a,b)=>a.pk-b.pk).map(col=>col.name),table.primaryKey)&&table.hasRowid===!/\bWITHOUT\s+ROWID\b/i.test(definition.sql),'Private v2 table columns differ from installed schema.');
   delta.tables=[...c.tables,table];delta.parents=[...parents,[...new Set(relationships.map(r=>BUSINESS_TABLES.indexOf(r.parent)).filter(index=>index>=0&&index!==c.tables.length))]];
  }
  if(result.kind==='done'){
   need(c.tables.length===BUSINESS_TABLES.length&&c.tables.length===c.root.tables.count,'Private v2 table inventory incomplete.');const remaining=new Map(parents.map((dependencies,index)=>[BUSINESS_TABLES[index],new Set(dependencies.map(parent=>BUSINESS_TABLES[parent]))]));remaining.get('app_epoch_freezes').add('earn_submissions');remaining.get('earn_admission_counts').add('earn_submissions');
   const order=[];while(remaining.size){const ready=[...remaining].filter(([,deps])=>[...deps].every(name=>order.includes(name))).map(([name])=>name).sort();need(ready.length>0,'Private v2 table dependency cycle.');for(const name of ready){order.push(name);remaining.delete(name);}}
   Object.assign(delta,{phase:'objects',tableOrder:recoveryTableOrderIndices(order,c.descriptor.tableNames),parents:null,objectCursor:null,tableCursor:null});
  }
  return repository.advance(loaded,{delta,records});
 }
 async function objects(loaded,c){
  const result=await walk('objects',c.root.objects,c.objectCursor),records=[];if(result.metadata)records.push(await copied(result.metadata.identity,result.metadata.bytes));if(result.kind==='entry')records.push(await copied(result.value));
  const delta={objectCursor:result.cursor};if(result.kind==='done')Object.assign(delta,{phase:'publications',publicationCursor:null,publicationCount:0});return repository.advance(loaded,{delta,records});
 }
 async function publications(loaded,c){
  const result=await walk('publications',c.root.publications,c.publicationCursor),records=[];if(result.metadata)records.push(await copied(result.metadata.identity,result.metadata.bytes));
  const delta={publicationCursor:result.cursor};if(result.kind==='entry'){const verified=await readPinnedPublication(artifacts,result.value,codec,crypto);if(verified.kind!=='verified')throw new MissingObject(verified.reason);delta.publicationCount=c.publicationCount+1;}
  if(result.kind==='done'){need(c.publicationCount===c.root.publications.count,'Private v2 public pin count mismatch.');Object.assign(delta,{phase:'tables',tableIndex:0,pageCursor:null,pageIndex:0,lastCursor:null,importedRows:0,activePage:null,rowOffset:0});}
  return repository.advance(loaded,{delta,records});
 }
 async function tables(loaded,c){
  const {indices,name}=recoveryTableOrderPosition(c.tableOrder,c.descriptor.tableNames,c.tableIndex);
  need(Array.isArray(c.tables)&&c.tables.length===indices.length&&c.root.tables.count===indices.length&&c.tables.every((table,index)=>table?.name===c.descriptor.tableNames[index]),'Private v2 import table inventory incomplete.');
  if(c.tableIndex===indices.length)return repository.advance(loaded,{delta:{phase:'fences',tableOrder:null}});
  // Old name arrays are compacted by their own ordinary checkpoint CAS before
  // resuming import, including fragmented rows. No row cursor is changed.
  if(typeof c.tableOrder[0]==='string')return repository.advance(loaded,{delta:{tableOrder:indices}});
  const table=c.tables[indices[c.tableIndex]];need(table&&table.name===name,'Missing private v2 table descriptor.');
  if(c.activePage){
   const entry=c.activePage,object=await verifyObject(artifacts,entry.identity,crypto);if(object.kind!=='verified')throw new MissingObject(object.reason);
   if(JSON.parse(new TextDecoder().decode(object.bytes)).format==='10x.local.recovery.fragmented-row.v2')return fragments.importPage(loaded,c,table,await fragmentCodec.verifyRowDescriptor(object.bytes,entry.identity));
   const page=await v2Codec.verifyRows(object.bytes,entry.identity);
   need(page.table===name&&page.index===c.pageIndex&&same(page.columns,table.columns)&&page.hasRowid===table.hasRowid&&same(page.after,c.lastCursor)&&same(entry.after,c.lastCursor)&&page.rows.length===entry.rowCount,'Private v2 row-page boundary mismatch.');
   const original=page.rows.slice(c.rowOffset,c.rowOffset+40);need(original.length>0,'Private v2 empty import chunk.');const rows=original.map(row=>fenceRow(table,row,{generation:loaded.state.generation,createdMs:c.root.createdMs})),effects=name==='app_revisions'?[]:rows.map(row=>sql(`INSERT OR IGNORE INTO ${quote(name)} (${[...(table.hasRowid?['rowid']:[]),...table.columns.map(quote)].join(',')}) VALUES(${row.map(()=>'?').join(',')})`,...row));
   const delta={rowOffset:c.rowOffset+rows.length,importedRows:c.importedRows+rows.length};if(name==='app_revisions')delta.restoredRevisions=rows.map(row=>objectRow(table,row));if(delta.rowOffset===page.rows.length)Object.assign(delta,{activePage:null,rowOffset:0,pageIndex:c.pageIndex+1,lastCursor:entry.last});
   const digest=await hashJson(crypto,['v2-imported-rows',name,c.pageIndex,c.rowOffset,rows]);return repository.advance(loaded,{delta,effects,records:[{key:'table:'+entry.identity.key+':'+c.rowOffset,digest:entry.identity.byteDigest,resultDigest:digest,rowCount:rows.length,tableName:name}]});
  }
  const result=await walk('table-pages',table.pages,c.pageCursor),records=[];if(result.metadata)records.push(await copied(result.metadata.identity,result.metadata.bytes));const delta={pageCursor:result.cursor};
  if(result.kind==='entry'){need(result.value.index===c.pageIndex&&same(result.value.after,c.lastCursor),'Private v2 imported page order mismatch.');delta.activePage=result.value;delta.rowOffset=0;}
  if(result.kind==='done'){need(c.importedRows===table.rowCount&&c.pageIndex===table.pages.count,'Private v2 imported table count mismatch.');Object.assign(delta,{tableIndex:c.tableIndex+1,pageCursor:null,pageIndex:0,lastCursor:null,importedRows:0,activePage:null,rowOffset:0});}
  return repository.advance(loaded,{delta,records});
 }
 async function fences(loaded,c){
  const revisions=c.restoredRevisions;need(Array.isArray(revisions)&&revisions.length===3&&['earn','source','control'].every(name=>revisions.some(r=>r.name===name&&Number.isSafeInteger(r.revision)&&r.revision>=0)),'Private v2 revision checkpoint incomplete.');
  const effects=[...AUTH_TABLES.map(table=>sql('DELETE FROM '+quote(table))),...revisions.map(r=>sql('UPDATE app_revisions SET revision=? WHERE name=?',r.revision,r.name))],digest=await hashJson(crypto,['v2-private-fences',loaded.state.generation,revisions]);
  return repository.advance(loaded,{delta:{phase:'pin-target',restoredRevisions:null},effects,records:[{key:'private-final-fences',digest,resultDigest:digest,rowCount:0,tableName:'recovery-fences'}]});
 }
 async function start(value){const {root,id}=await input(value),old=await repository.load(id);if(old.run)return repository.outcome(old,'replayed');const descriptor=await readRecoveryV2SourceMetadata(driver,{schema,crypto});return repository.start({root,pinnedDigest:id,descriptor});}
 async function step(value){
  const request=await input(value);need(Number.isSafeInteger(request.expectedRevision)&&request.expectedRevision>=0,'Private v2 continuation revision required.');const loaded=await repository.load(request.id);if(!loaded.run||loaded.state.active_restore_id!==request.id)return conflict('recovery-not-started');try{const c=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json);
  if(c.format!=='10x.local.recovery.restore.v2')return conflict('recovery-format-conflict');if(loaded.run.state!=='restoring'||c.revision>request.expectedRevision)return repository.outcome(loaded,'replayed');if(c.revision!==request.expectedRevision)return conflict('recovery-revision-conflict');
   if(c.phase==='metadata')return await metadata(loaded,c);if(c.phase==='objects')return await objects(loaded,c);if(c.phase==='publications')return await publications(loaded,c);if(c.phase==='tables')return await tables(loaded,c);if(c.phase==='fences')return await fences(loaded,c);
   if(c.phase==='pin-target'){const [rows]=await read([sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]),watermark=rows[0]?.revision;return repository.advance(loaded,{delta:{phase:'reconcile-objects',targetWatermark:watermark,objectCursor:null},targetWatermark:watermark,pinTarget:true});}
   if(c.phase.startsWith('reconcile-'))return await reconciler.step(loaded);if(c.phase==='final-ready')return await repository.finish(loaded);return conflict('recovery-phase-unavailable');
  }catch(error){return error instanceof MissingObject?conflict(error.message):repository.hold(loaded,'recovery-import-invalid:'+error.message);}
 }
 return Object.freeze({start,step,async finish(value){const request=await input(value),loaded=await repository.load(request.id);if(!loaded.run||loaded.state.active_restore_id!==request.id)return conflict('recovery-not-started');if(loaded.run.state==='ready')return repository.outcome(loaded,'replayed');const c=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json);if(c.phase!=='final-ready')return conflict('recovery-reconciliation-incomplete');if(request.expectedRevision!==c.revision)return conflict('recovery-revision-conflict');return repository.finish(loaded);}});
}
