// Node-only, explicitly synthetic local recovery acceptance fixtures.
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {recoveryFixture,memoryArtifacts} from './fixtures.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Restore} from './v2-restore.mjs';
import {createJobRepository} from '../jobs/repository.mjs';
import {createJobCommand} from '../jobs/model.mjs';
export async function v2RestoreSource(t,{corruption=null,jobs=true}={}){
 const f=await recoveryFixture();t.after(()=>f.db.close());const now=Date.now();f.clock={nowMs:()=>now};f.db.function('v2_fixture_clock',()=>now);f.driver={...f.driver,leaseNowSql:'v2_fixture_clock()'};let lease=null;const principal={kind:'operator',id:'synthetic-v2-recovery'};
 if(jobs){f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'jobs-runner');const repository=createJobRepository(f.driver,{...f,principal});assertCommitted(await repository.enqueue(await createJobCommand({principal,requestKey:'synthetic-active-job',nowMs:now,input:{businessKey:'synthetic-active-job',sourceKey:'synthetic-source',type:'retention-maintenance',payload:{synthetic:true},readyMs:now,maxAttempts:5}},f.crypto)));const acquired=await repository.acquireJob();if(acquired.kind!=='acquired')throw Error(JSON.stringify(acquired));lease=acquired.job.lease;f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('synthetic-active-session','w1','http://localhost',now+86400000);}
 if(corruption==='award')f.db.exec("UPDATE earn_awards SET amount='999999999999' WHERE rowid=(SELECT MIN(rowid) FROM earn_awards)");
 if(corruption==='audit'){const trigger=f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='ops_audit_no_edit'").get().sql;f.db.exec("DROP TRIGGER ops_audit_no_edit;UPDATE ops_config_audit SET event_hash='"+'0'.repeat(64)+"' WHERE seq=(SELECT MAX(seq) FROM ops_config_audit);");f.db.exec(trigger);}
 const v2Codec=createRecoveryV2Codec(f),capture=createRecoveryV2Capture({...f,v2Codec,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-v2-restore-source',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&captured.kind!=='captured';n++){if(!['started','progress','replayed'].includes(captured.kind))throw Error(JSON.stringify(captured));captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});}if(captured.kind!=='captured')throw Error('Synthetic capture did not finish.');return {...f,v2Codec,captured,lease,principal,now};
}
function assertCommitted(value){if(!['committed','replayed'].includes(value.kind))throw Error(JSON.stringify(value));}
export function v2RestoreTarget(t,f,{faults=[]}={}){
 const db=openDatabase();t.after(()=>db.close());db.function('v2_fixture_clock',()=>f.now);const base={...createNodeAtomicDriver(db),leaseNowSql:'v2_fixture_clock()'},injected=new Set(),metrics=[];let current=null,lastRevision=0,result=null;
 const driver={...base,async batch(input){if(current){const m=measureBatch(input);current.sql+=input.length;current.maxBatchBytes=Math.max(current.maxBatchBytes,m.batchBytes);}let selected=input;
  for(const fault of faults){if(injected.has(fault))continue;
   if(fault==='omit-fragment'&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_row_fragments'))){selected=selected.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_row_fragments'));injected.add(fault);}
   if(fault==='omit-fragment-row'&&input.some(s=>s.sql.includes('WITH selected AS')&&s.sql.includes('INSERT OR IGNORE INTO fair_inventories'))){selected=selected.filter(s=>!(s.sql.includes('WITH selected AS')&&s.sql.includes('INSERT OR IGNORE INTO fair_inventories')));injected.add(fault);}
   if(fault==='omit-fragment-check'&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-fragments')){selected=selected.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));injected.add(fault);}
   if(fault==='omit-award'&&input.some(s=>s.sql.startsWith('INSERT OR IGNORE INTO "earn_awards"'))){let removed=false;selected=selected.filter(s=>{if(!removed&&s.sql.startsWith('INSERT OR IGNORE INTO "earn_awards"')){removed=true;return false;}return true;});injected.add(fault);}
   if(fault==='omit-check'&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-pages')){selected=selected.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));injected.add(fault);}
   if(fault==='omit-final-state'&&input.some(s=>s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"))){selected=selected.filter(s=>!s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"));injected.add(fault);}
  }
  const rows=await base.batch(selected);if(current)current.returnedBytes+=Buffer.byteLength(JSON.stringify(rows));for(const [fault,match]of [['lost-fragment-ack',s=>s.sql.startsWith('INSERT INTO app_recovery_row_fragments')],['lost-fragment-row-ack',s=>s.sql.includes('WITH selected AS')&&s.sql.includes('INSERT OR IGNORE INTO fair_inventories')],['lost-final-ack',s=>s.sql.startsWith("UPDATE app_recovery_state SET status='ready'")]])if(faults.includes(fault)&&!injected.has(fault)&&input.some(match)){injected.add(fault);throw Error('Synthetic lost accepted restore acknowledgement.');}return rows;
 }},store=memoryArtifacts(),artifacts={async getVerified(identity){if(current)current.objectReads++;const object=await store.getVerified(identity);if(current&&object.status==='verified')current.objectBytes+=object.bytes.length;return object;},async putIfAbsent(identity,bytes){if(current){current.objectWrites++;current.objectBytes+=bytes.length;}return store.putIfAbsent(identity,bytes);}},sourceArtifacts={async getVerified(identity){if(current)current.objectReads++;const object=await f.store.getVerified(identity);if(current&&object.status==='verified')current.objectBytes+=object.bytes.length;return object;}},service=createRecoveryV2Restore({...f,driver,artifacts,sourceArtifacts}),input={root:f.captured.value,pinnedDigest:f.captured.digest};
 const call=async method=>{current={method,sql:0,objectReads:0,objectWrites:0,objectBytes:0,returnedBytes:0,maxBatchBytes:0};try{result=await service[method]({...input,...(method==='start'?{}:{expectedRevision:lastRevision})});if(Number.isSafeInteger(result.revision))lastRevision=result.revision;return result;}finally{metrics.push(current);current=null;}};
 const drive=async({stopPhase=null,resume=false}={})=>{if(result===null)await call('start');else if(resume)await call('step');for(let n=0;n<20000;n++){if(!['started','progress','replayed'].includes(result.kind)||stopPhase&&result.phase===stopPhase)return result;await call('step');}throw Error('Synthetic restore continuation ceiling.');};
 return {db,driver,store,service,input,call,drive,metrics,injected,checkpoint:()=>JSON.parse(db.prepare('SELECT checkpoint_json FROM app_recovery_runs WHERE id=?').get(input.pinnedDigest).checkpoint_json)};
}
