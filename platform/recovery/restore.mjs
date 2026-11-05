import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {verifyPinnedInventory,clone,demand,hashJson,verifyObject,persistObject} from './inventory.mjs';
import {BUSINESS_TABLES,AUTH_TABLES,readSchema,quote} from './schema.mjs';
import {fenceRow,readRecoveryPage,readPinnedPublication,reconcileRecovery} from './reconcile.mjs';

const pending=reason=>({kind:'pending',reason}),conflict=code=>({kind:'conflict',code});
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const conjunction=items=>items.length===1?items[0]:'('+conjunction(items.slice(0,Math.floor(items.length/2)))+' AND '+conjunction(items.slice(Math.floor(items.length/2)))+')';
export const createPublicRecovery=ports=>createRecovery('public',ports);
export const createPrivateRecovery=ports=>createRecovery('private',ports);

function createRecovery(mode,{driver,artifacts,sourceArtifacts=artifacts,codec,crypto,clock,ids,schema}){
 schema=schema?clone(schema):null;
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function input(value){const captured=clone(value),inventory=await verifyPinnedInventory(captured.inventory,captured.pinnedDigest,crypto);demand(inventory.mode===mode,'Use the explicit matching recovery mode.');
  if(mode==='private')demand(schema&&same(schema,inventory.schema),'Private recovery schema differs from installed migrations.');
  return {inventory,id:captured.pinnedDigest};
 }
 async function state(id){const [states,runs]=await read([sql('SELECT * FROM app_recovery_state WHERE id=1'),sql('SELECT * FROM app_recovery_runs WHERE id=?',id)]);return {state:states[0],run:runs[0]};}
 async function orderTables(inventory){
  const descriptor=await readSchema(driver);
  demand(same(descriptor.tables,inventory.tables.map(({name,columns,primaryKey,hasRowid})=>({name,columns,primaryKey,hasRowid}))),'Private table schema differs from installed schema.');
  const relationships=await read(descriptor.tables.map(t=>sql('SELECT "table" parent FROM pragma_foreign_key_list(?)',t.name)));
  const remaining=new Map(descriptor.tables.map((t,index)=>[t.name,new Set(relationships[index].map(r=>r.parent).filter(p=>p!==t.name&&BUSINESS_TABLES.includes(p)))]));
  remaining.get('app_epoch_freezes').add('earn_submissions');remaining.get('earn_admission_counts').add('earn_submissions');
  const result=[];while(remaining.size){const ready=[...remaining].filter(([,deps])=>[...deps].every(d=>result.includes(d))).map(([name])=>name).sort();demand(ready.length,'Recovery table dependency cycle.');for(const name of ready){result.push(name);remaining.delete(name);}}
  return result;
 }
 function units(inventory,tableOrder=[]){
  const result=inventory.objects.map(identity=>({kind:'object',identity,key:'object:'+identity.key}));
  if(mode==='public')inventory.publications.forEach((pin,pinIndex)=>{
   result.push({kind:'board',pinIndex,key:'board:'+pin.identity.key});pin.allocations.forEach((a,index)=>result.push({kind:'allocation',pinIndex,index,key:'allocation:'+pin.identity.key+':'+index}));
  });else{
   for(const name of tableOrder){const table=inventory.tables.find(t=>t.name===name);table.pages.forEach((identity,index)=>result.push({kind:'table',table,identity,index,key:'table:'+identity.key}));}
   result.push({kind:'fences',key:'private-final-fences'});
  }return result;
 }
 async function hold(id,reason){
  await driver.batch([sql("UPDATE app_recovery_runs SET state='held',updated_ms=?,report_json=? WHERE id=? AND state<>'ready'",clock.nowMs(),canonicalJson({reason}),id),
   sql("UPDATE app_recovery_state SET status='held',write_nonce=NULL WHERE id=1 AND active_restore_id=? AND status<>'ready'",id)]);return {kind:'held',reason,restoreId:id};
 }
 async function start(value){
  const {inventory,id}=await input(value),existing=await state(id);
  if(existing.run?.state==='ready')return {kind:'replayed',restoreId:id,report:JSON.parse(existing.run.report_json)};
  if(existing.state.mode!==mode&&existing.state.mode!=='live')return conflict('separate-recovery-database-required');
  if(existing.state.mode==='private'&&existing.state.active_restore_id!==id)return conflict('separate-recovery-database-required');
  if(['restoring','held'].includes(existing.state.status)&&existing.state.active_restore_id!==id)return conflict('another-restore-is-active');
  const tableOrder=mode==='private'?await orderTables(inventory):[],work=units(inventory,tableOrder);
  if(existing.run){
   await driver.batch([sql("UPDATE app_recovery_runs SET state='restoring',updated_ms=? WHERE id=? AND state='held'",clock.nowMs(),id),sql("UPDATE app_recovery_state SET status='restoring' WHERE active_restore_id=? AND inventory_digest=?",id,id)]);
   return {kind:'started',restoreId:id,units:work.length};
  }
  const generation=ids.next(),checkpoint={cursor:0,units:work.length,tableOrder,generation};
  const fresh=existing.state.mode==='live';
  const empty=fresh?conjunction([...BUSINESS_TABLES.filter(t=>t!=='app_revisions'),...AUTH_TABLES].map(t=>`NOT EXISTS(SELECT 1 FROM ${quote(t)})`).concat("(SELECT COUNT(*) FROM app_revisions)=3","NOT EXISTS(SELECT 1 FROM app_revisions WHERE revision<>0 OR name NOT IN ('earn','source','control'))")):'1';
  const gate=`EXISTS(SELECT 1 FROM app_recovery_state WHERE id=1 AND generation=? AND active_restore_id IS ? AND status=?) AND ${empty}`;
  const args=[existing.state.generation,existing.state.active_restore_id,existing.state.status];
  await driver.batch([
   sql(`INSERT INTO app_recovery_runs SELECT ?,?,?,?,?, 'restoring',?,?,?,NULL WHERE ${gate}`,id,mode,id,inventory.sourceCommit,inventory.schema?.fingerprint??null,clock.nowMs(),clock.nowMs(),canonicalJson(checkpoint),...args),
   sql(`UPDATE app_recovery_state SET mode=?,status='restoring',generation=?,active_restore_id=?,inventory_digest=?,source_commit=?,schema_fingerprint=?,write_nonce=NULL WHERE id=1 AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=?) AND ${gate}`,mode,generation,id,id,inventory.sourceCommit,inventory.schema?.fingerprint??null,id,...args),
  ]);
  const created=await state(id);return created.run&&created.state.active_restore_id===id?{kind:'started',restoreId:id,units:work.length}:conflict('separate-recovery-database-required');
 }
 async function writeUnit({id,run,current,unit,statements=[],rowCount=0,tableName='',digest}){
  const checkpoint=JSON.parse(run.checkpoint_json),nonce=ids.next(),cursor=checkpoint.cursor;
  const gate="EXISTS(SELECT 1 FROM app_recovery_state WHERE active_restore_id=? AND status='restoring' AND write_nonce=?)";
  const next={...checkpoint,cursor:cursor+1};
  const batch=[sql("UPDATE app_recovery_state SET write_nonce=? WHERE id=1 AND active_restore_id=? AND status='restoring' AND generation=? AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='restoring' AND json_extract(checkpoint_json,'$.cursor')=?)",nonce,id,current.generation,id,cursor),
   sql("UPDATE app_recovery_state SET status=CASE WHEN active_restore_id=? AND status='restoring' AND write_nonce=? AND generation=? AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='restoring' AND json_extract(checkpoint_json,'$.cursor')=?) THEN status ELSE 'invalid-recovery-lease' END WHERE id=1",id,nonce,current.generation,id,cursor),...statements,
   sql(`INSERT INTO app_recovery_pages SELECT ?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT DO NOTHING`,id,unit.key,unit.identity?.byteDigest??digest,tableName,rowCount,digest,clock.nowMs(),id,nonce),
   sql('UPDATE app_recovery_state SET write_nonce=NULL WHERE active_restore_id=? AND write_nonce=?',id,nonce),
   // The CHECK constraint aborts the WHOLE batch if a transport adapter ever
   // omits the nonce-clear effect. A recovery capability cannot leak committed.
   sql("UPDATE app_recovery_state SET status=CASE WHEN write_nonce IS NULL THEN status ELSE 'invalid-recovery-nonce' END WHERE id=1"),
   sql("UPDATE app_recovery_runs SET checkpoint_json=?,updated_ms=? WHERE id=? AND state='restoring' AND json_extract(checkpoint_json,'$.cursor')=? AND EXISTS(SELECT 1 FROM app_recovery_pages WHERE restore_id=? AND page_key=? AND result_digest=?)",canonicalJson(next),clock.nowMs(),id,cursor,id,unit.key,digest)];
  measureBatch(batch);try{await driver.batch(batch);}catch(error){const reread=await state(id);if(JSON.parse(reread.run?.checkpoint_json??'{}').cursor>cursor)return {kind:'replayed',restoreId:id,cursor:cursor+1};throw error;}
  const reread=await state(id);demand(reread.state.write_nonce===null,'Recovery nonce persisted after a write.');
  return JSON.parse(reread.run.checkpoint_json).cursor>cursor?{kind:'progress',restoreId:id,cursor:cursor+1}:pending('recovery-write-conflict');
 }
 async function step(value){
  const {inventory,id}=await input(value),loaded=await state(id),current=loaded.state,run=loaded.run;
  if(!run||current.active_restore_id!==id)return conflict('recovery-not-started');if(run.state==='ready')return {kind:'replayed',restoreId:id,report:JSON.parse(run.report_json)};
  if(run.state!=='restoring'||current.status!=='restoring')return pending('recovery-held');
  const checkpoint=JSON.parse(run.checkpoint_json),work=units(inventory,checkpoint.tableOrder),unit=work[checkpoint.cursor];
  demand(work.length===checkpoint.units,'Recovery work inventory changed.');if(!unit)return {kind:'imported',restoreId:id};
  let statements=[],rowCount=0,tableName='objects',digest;
  if(unit.kind==='object'){
   const source=await verifyObject(sourceArtifacts,unit.identity,crypto);if(source.kind!=='verified')return hold(id,source.reason);
   const copied=await persistObject(artifacts,unit.identity,source.bytes,crypto);if(copied.kind!=='verified')return hold(id,copied.reason);digest=unit.identity.byteDigest;
  }else if(unit.kind==='board'||unit.kind==='allocation'){
   const pin=inventory.publications[unit.pinIndex],result=await readPinnedPublication(artifacts,pin,codec,crypto);if(result.kind!=='verified')return hold(id,result.reason);
   const manifest=result.verified.manifest;
   if(unit.kind==='board'){
    const [old]=await read([sql('SELECT * FROM earn_recovered_boards WHERE epoch=?',pin.epoch)]);if(old[0]&&(old[0].board_id!==pin.boardId||!same(JSON.parse(old[0].board_json),manifest.board)))return hold(id,'public-board-conflict');
    statements=[sql('INSERT INTO earn_recovered_boards VALUES(?,?,?) ON CONFLICT DO NOTHING',pin.epoch,pin.boardId,canonicalJson(manifest.board)),
     sql('INSERT INTO manifest_catalog VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING',pin.identity.byteDigest,pin.identity.key,pin.identity.size,'earn-archive-v1',inventory.createdMs)];rowCount=1;tableName='earn_recovered_boards';digest=pin.boardId;
   }else{
    const a=manifest.allocations[unit.index],allocationId=await codec.allocationDigest(a),[old]=await read([sql('SELECT * FROM earn_recovered_allocations WHERE token_id=? AND day=?',a.tokenId,a.day)]);
    if(old[0]&&(old[0].allocation_id!==allocationId||!same(JSON.parse(old[0].allocation_json),a)))return hold(id,'public-allocation-conflict');
    statements=[sql('INSERT INTO earn_recovered_allocations VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING',a.tokenId,a.day,pin.epoch,allocationId,canonicalJson(a)),
     ...a.awards.map(w=>sql('INSERT INTO earn_recovered_awards VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING',w.wallet,a.tokenId,a.day,w.amountUnits,a.vestsFromMs,a.vestsThroughMs))];
    rowCount=a.awards.length;tableName='earn_recovered_allocations';digest=allocationId;
   }
  }else if(unit.kind==='table'){
   const page=await readRecoveryPage(artifacts,unit.identity,unit.table,unit.index,crypto);if(page.kind!=='verified')return hold(id,page.reason);
   const rows=page.rows.map(row=>fenceRow(unit.table,row,{generation:current.generation,createdMs:inventory.createdMs}));
   // Admission counts are populated by submission triggers; revisions are reset
   // only after all source-triggered imports in the final fenced unit.
   if(unit.table.name!=='app_revisions')statements=rows.map(row=>sql(`INSERT OR IGNORE INTO ${quote(unit.table.name)} (${[...(unit.table.hasRowid?['rowid']:[]),...unit.table.columns.map(quote)].join(',')}) VALUES(${row.map(()=>'?').join(',')})`,...row));
   rowCount=rows.length;tableName=unit.table.name;digest=await hashJson(crypto,rows);
  }else{
   const revisions=inventory.checkpoints.revisions;demand(Array.isArray(revisions)&&revisions.length===3&&['earn','source','control'].every(name=>revisions.some(r=>r.name===name&&Number.isSafeInteger(r.revision)&&r.revision>=0)),'Invalid restored revision checkpoint.');
   statements=[...AUTH_TABLES.map(table=>sql('DELETE FROM '+quote(table))),...revisions.map(r=>sql('UPDATE app_revisions SET revision=? WHERE name=?',r.revision,r.name))];
   tableName='recovery-fences';digest=await hashJson(crypto,[current.generation,revisions,inventory.authPolicy]);
  }
  try{return await writeUnit({id,run,current,unit,statements,rowCount,tableName,digest});}catch(error){return hold(id,'recovery-write-failed:'+String(error.message).slice(0,160));}
 }
 async function finish(value){
  const {inventory,id}=await input(value),loaded=await state(id);if(!loaded.run||loaded.state.active_restore_id!==id)return conflict('recovery-not-started');
  if(loaded.run.state==='ready')return {kind:'replayed',restoreId:id,report:JSON.parse(loaded.run.report_json)};
  const checkpoint=JSON.parse(loaded.run.checkpoint_json);if(checkpoint.cursor!==checkpoint.units)return pending('recovery-import-incomplete');
  let report;try{report=await reconcileRecovery({driver,artifacts,codec,crypto,inventory,generation:loaded.state.generation});}catch(error){return hold(id,'recovery-reconciliation-failed:'+String(error.message).slice(0,160));}
  if(report.kind!=='verified')return hold(id,report.reason);
  const text=canonicalJson(report);await driver.batch([sql("UPDATE app_recovery_runs SET state='ready',updated_ms=?,report_json=? WHERE id=? AND state='restoring' AND checkpoint_json=? AND EXISTS(SELECT 1 FROM app_recovery_state WHERE active_restore_id=? AND generation=? AND status='restoring' AND write_nonce IS NULL)",clock.nowMs(),text,id,loaded.run.checkpoint_json,id,loaded.state.generation),
   sql("UPDATE app_recovery_state SET status='ready',write_nonce=NULL WHERE active_restore_id=? AND generation=? AND status='restoring' AND write_nonce IS NULL AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='ready' AND report_json=? AND checkpoint_json=?)",id,loaded.state.generation,id,text,loaded.run.checkpoint_json)]);
  const saved=await state(id);return saved.run.state==='ready'&&saved.state.status==='ready'&&saved.state.active_restore_id===id?{kind:'restored',restoreId:id,report}:pending('recovery-finalize-conflict');
 }
 return Object.freeze({start,step,finish,async restore(value){value=clone(value);const started=await start(value);if(started.kind==='replayed'||started.kind!=='started')return started;
  for(let n=0;n<=started.units;n++){const result=await step(value);if(result.kind==='imported')return finish(value);if(!['progress','replayed'].includes(result.kind))return result;}
  return pending('recovery-step-bound');
 }});
}
