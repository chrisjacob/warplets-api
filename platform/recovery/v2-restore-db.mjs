import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {BUSINESS_TABLES,AUTH_TABLES,quote} from './schema.mjs';
import {recoveryV2SchemaFence} from './v2-schema.mjs';
const clone=value=>JSON.parse(canonicalJson(value));
function need(c,message){if(!c)throw new TypeError(message);}
const and=items=>items.length===1?items[0]:'('+and(items.slice(0,Math.floor(items.length/2)))+' AND '+and(items.slice(Math.floor(items.length/2)))+')';
const empty=and([...BUSINESS_TABLES.filter(t=>t!=='app_revisions'),...AUTH_TABLES].map(t=>`NOT EXISTS(SELECT 1 FROM ${quote(t)})`).concat("(SELECT COUNT(*) FROM app_revisions)=3","NOT EXISTS(SELECT 1 FROM app_revisions WHERE revision<>0 OR name NOT IN ('earn','source','control'))"));
const checkpointLimit=131072;
/** Internal mutation-fenced continuation storage, not a public SQL interface.
 * Named restore phases own all effects. Checkpoint patches never resend the
 * immutable root/schema with a row-page import. V1 is untouched. */
export function createRecoveryV2RestoreDatabase({driver,clock,ids}){
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function load(id,summary=false){const [runs,states]=await read([sql(summary?"SELECT id,state,report_json,json_object('revision',json_extract(checkpoint_json,'$.revision'),'phase',json_extract(checkpoint_json,'$.phase')) checkpoint_json FROM app_recovery_runs WHERE id=?":'SELECT * FROM app_recovery_runs WHERE id=?',id),sql('SELECT * FROM app_recovery_state WHERE id=1')]);return {run:runs[0]??null,state:states[0]??null};}
 function outcome(loaded,kind='progress'){
  const {run,state}=loaded;if(!run||!state)return {kind:'conflict',code:'recovery-not-started'};const c=JSON.parse(run.checkpoint_json);
  if(run.state==='ready'&&state.status==='ready')return {kind:'restored',restoreId:run.id,report:JSON.parse(run.report_json)};
  return run.state==='held'||state.status==='held'?{kind:'held',restoreId:run.id,revision:c.revision,reason:JSON.parse(run.report_json??'{}').reason??'recovery-held'}:{kind,restoreId:run.id,revision:c.revision,phase:c.phase};
 }
 async function start(input){
  const {root,pinnedDigest,descriptor}=clone(input),old=await load(pinnedDigest);if(old.run)return outcome(old,'replayed');
  if(old.state?.mode!=='live'||old.state.status!=='live'||old.state.write_nonce!==null)return {kind:'conflict',code:'separate-recovery-database-required'};
  const generation=ids.next(),now=clock.nowMs(),checkpoint={format:'10x.local.recovery.restore.v2',revision:0,phase:'metadata',root,descriptor,generation,tables:[],tableCursor:null};need(utf8(canonicalJson(checkpoint)).length<=checkpointLimit,'V2 restore checkpoint bound.');
  const gate=`EXISTS(SELECT 1 FROM app_recovery_state WHERE id=1 AND generation=? AND mode='live' AND status='live' AND active_restore_id IS NULL AND write_nonce IS NULL) AND ${empty}`;
  const statements=[sql(`INSERT INTO app_recovery_runs(id,mode,inventory_digest,source_commit,schema_fingerprint,state,created_ms,updated_ms,checkpoint_json,report_json) SELECT ?,'private',?,?,?,'restoring',?,?,?,NULL WHERE ${gate}`,pinnedDigest,pinnedDigest,root.sourceCommit,root.schema.fingerprint,now,now,canonicalJson(checkpoint),old.state.generation),
   sql(`UPDATE app_recovery_state SET mode='private',status='restoring',generation=?,active_restore_id=?,inventory_digest=?,source_commit=?,schema_fingerprint=?,write_nonce=NULL WHERE id=1 AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=?) AND ${gate}`,generation,pinnedDigest,pinnedDigest,root.sourceCommit,root.schema.fingerprint,pinnedDigest,old.state.generation),
   sql("UPDATE app_recovery_state SET status=CASE WHEN active_restore_id=? AND generation=? AND status='restoring' THEN status ELSE 'invalid-v2-recovery-start' END WHERE id=1",pinnedDigest,generation)];
  measureBatch(statements);try{await driver.batch(statements);}catch{const saved=await load(pinnedDigest);return saved.run&&saved.state?.active_restore_id===pinnedDigest?outcome(saved,'replayed'):{kind:'conflict',code:'recovery-start-unknown'};}return outcome(await load(pinnedDigest),'started');
 }
 async function hold(loaded,reason){const {run}=loaded,c=JSON.parse(run.checkpoint_json);reason=String(reason).slice(0,240);await driver.batch([
  sql("UPDATE app_recovery_runs SET state='held',report_json=?,updated_ms=? WHERE id=? AND state='restoring' AND json_extract(checkpoint_json,'$.revision')=?",canonicalJson({reason}),clock.nowMs(),run.id,c.revision),
  sql("UPDATE app_recovery_state SET status='held',write_nonce=NULL WHERE active_restore_id=? AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='held')",run.id,run.id)]);return outcome(await load(run.id));}
 async function advance(loaded,input){
  const {run,state}=clone(loaded),request=clone(input),checkpoint=JSON.parse(run.checkpoint_json),delta=request.delta??{},records=request.records??[],effects=request.effects??[],check=request.check??null;
  need(Object.keys(delta).length<=16&&Object.keys(delta).every(k=>/^[A-Za-z][A-Za-z0-9]*$/.test(k)&&!['root','descriptor','generation','format','revision'].includes(k)),'Invalid v2 restore patch.');need(records.length<=4&&effects.length<=48,'V2 restore mutation bound.');const next={...checkpoint,...delta,revision:checkpoint.revision+1};need(utf8(canonicalJson(next)).length<=checkpointLimit,'V2 restore checkpoint bound.');
  const nonce=ids.next(),expectedWatermark=request.targetWatermark??null;
  if(expectedWatermark!==null)need(Number.isSafeInteger(expectedWatermark)&&expectedWatermark>=0&&(checkpoint.targetWatermark===expectedWatermark||request.pinTarget===true&&checkpoint.phase==='pin-target'&&delta.targetWatermark===expectedWatermark),'V2 target watermark binding mismatch.');
  const authority=`EXISTS(SELECT 1 FROM app_recovery_runs r CROSS JOIN app_recovery_state s WHERE r.id=? AND r.state='restoring' AND json_extract(r.checkpoint_json,'$.revision')=? AND s.id=1 AND s.mode='private' AND s.status='restoring' AND s.active_restore_id=r.id AND s.generation=? AND s.write_nonce IS NULL AND ${recoveryV2SchemaFence("json_extract(r.checkpoint_json,'$.descriptor')")})${expectedWatermark===null?'':' AND (SELECT revision FROM app_recovery_watermark WHERE id=1)=?'}`;
  const authorityValues=[run.id,checkpoint.revision,state.generation,...(expectedWatermark===null?[]:[expectedWatermark])];
  const statements=[sql(`UPDATE app_recovery_state SET write_nonce=? WHERE id=1 AND ${authority}`,nonce,...authorityValues),sql("UPDATE app_recovery_state SET status=CASE WHEN active_restore_id=? AND generation=? AND status='restoring' AND write_nonce=? THEN status ELSE 'invalid-v2-recovery-lease' END WHERE id=1",run.id,state.generation,nonce),...effects];
  const required=[],values=[];
  for(const record of records){
   need(typeof record.key==='string'&&record.key.length<=256&&/^[a-f0-9]{64}$/.test(record.digest)&&/^[a-f0-9]{64}$/.test(record.resultDigest)&&Number.isSafeInteger(record.rowCount)&&record.rowCount>=0,'Invalid v2 restore record.');
   statements.push(sql('INSERT INTO app_recovery_pages(restore_id,page_key,byte_digest,table_name,row_count,result_digest,created_ms) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',run.id,record.key,record.digest,record.tableName??'',record.rowCount,record.resultDigest,clock.nowMs()));
   required.push('EXISTS(SELECT 1 FROM app_recovery_pages WHERE restore_id=? AND page_key=? AND byte_digest=? AND row_count=? AND result_digest=?)');values.push(run.id,record.key,record.digest,record.rowCount,record.resultDigest);
  }
  if(check){need(expectedWatermark!==null&&check.targetWatermark===expectedWatermark,'Reconciliation requires exact pinned target watermark.');statements.push(sql('INSERT INTO app_recovery_reconcile_checks(restore_id,phase,scope,ordinal,target_watermark,result_digest,item_count) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',run.id,check.phase,check.scope,check.ordinal,check.targetWatermark,check.resultDigest,check.itemCount));required.push('EXISTS(SELECT 1 FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase=? AND scope=? AND ordinal=? AND target_watermark=? AND result_digest=? AND item_count=?)');values.push(run.id,check.phase,check.scope,check.ordinal,check.targetWatermark,check.resultDigest,check.itemCount);}
  statements.push(sql('UPDATE app_recovery_state SET write_nonce=NULL WHERE active_restore_id=? AND write_nonce=?',run.id,nonce),sql("UPDATE app_recovery_state SET status=CASE WHEN write_nonce IS NULL THEN status ELSE 'invalid-v2-recovery-nonce' END WHERE id=1"));
  const patches=["'$.revision',?"],patchValues=[next.revision];for(const [key,value]of Object.entries(delta)){patches.push(`'$.${key}',json(?)`);patchValues.push(canonicalJson(value));}
  statements.push(sql(`UPDATE app_recovery_runs SET checkpoint_json=json_set(checkpoint_json,${patches.join(',')}),updated_ms=? WHERE id=? AND state='restoring' AND json_extract(checkpoint_json,'$.revision')=?${required.length?' AND '+required.join(' AND '):''}${expectedWatermark===null?'':' AND (SELECT revision FROM app_recovery_watermark WHERE id=1)=?'}`,...patchValues,clock.nowMs(),run.id,checkpoint.revision,...values,...(expectedWatermark===null?[]:[expectedWatermark])));
  measureBatch(statements);let unknown=false;try{await driver.batch(statements);}catch{unknown=true;}
  const saved=await load(run.id,true);if(saved.state.write_nonce!==null)return hold(saved,'recovery-nonce-not-cleared');if(JSON.parse(saved.run.checkpoint_json).revision>checkpoint.revision)return outcome(saved,unknown?'replayed':'progress');
  if(expectedWatermark!==null){const [rows]=await read([sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);if(rows[0]?.revision!==expectedWatermark)return hold(saved,'recovery-target-changed');}
  return {kind:'conflict',code:unknown?'recovery-write-unknown':'recovery-write-conflict'};
 }
 async function finish(loaded){
  loaded=clone(loaded);const {run,state}=loaded,c=JSON.parse(run.checkpoint_json);need(c.phase==='final-ready'&&Number.isSafeInteger(c.targetWatermark)&&/^[a-f0-9]{64}$/.test(c.finalDigest),'V2 final reconciliation required.');const report=canonicalJson(c.finalReport);
  const authority=`EXISTS(SELECT 1 FROM app_recovery_state s WHERE s.id=1 AND s.mode='private' AND s.status='restoring' AND s.active_restore_id=? AND s.generation=? AND s.write_nonce IS NULL) AND (SELECT revision FROM app_recovery_watermark WHERE id=1)=? AND EXISTS(SELECT 1 FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase='final' AND scope='target' AND ordinal=0 AND target_watermark=? AND result_digest=?)`;
  const values=[run.id,state.generation,c.targetWatermark,run.id,c.targetWatermark,c.finalDigest],statements=[
   sql(`UPDATE app_recovery_runs AS r SET state='ready',report_json=?,updated_ms=? WHERE r.id=? AND r.state='restoring' AND json_extract(r.checkpoint_json,'$.revision')=? AND ${authority} AND ${recoveryV2SchemaFence("json_extract(r.checkpoint_json,'$.descriptor')")}`,report,clock.nowMs(),run.id,c.revision,...values),
   sql("UPDATE app_recovery_state SET status='ready',write_nonce=NULL WHERE id=1 AND active_restore_id=? AND generation=? AND status='restoring' AND write_nonce IS NULL AND (SELECT revision FROM app_recovery_watermark WHERE id=1)=? AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='ready' AND report_json=?)",run.id,state.generation,c.targetWatermark,run.id,report),
   sql("UPDATE app_recovery_state SET status=CASE WHEN status='ready' AND active_restore_id=? AND generation=? AND write_nonce IS NULL AND EXISTS(SELECT 1 FROM app_recovery_runs WHERE id=? AND state='ready' AND report_json=?) THEN status ELSE 'invalid-v2-recovery-finalize' END WHERE id=1",run.id,state.generation,run.id,report)];
  measureBatch(statements);try{await driver.batch(statements);}catch{}
  const saved=await load(run.id,true);if(saved.run?.state==='ready'&&saved.state?.status==='ready')return outcome(saved);
  const [rows]=await read([sql('SELECT revision FROM app_recovery_watermark WHERE id=1')]);return rows[0]?.revision!==c.targetWatermark?hold(saved,'recovery-target-changed'):{kind:'conflict',code:'recovery-finalize-unknown'};
 }
 return Object.freeze({load,start,advance,hold,outcome,finish});
}
