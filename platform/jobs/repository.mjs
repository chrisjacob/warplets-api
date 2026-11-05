import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
import {clone,boundedJson,jobRequestBytes,validateJobInput,jobFromRow,pending,conflict} from './model.mjs';
// Internal manual-runner authority, never supplied by a public job endpoint.
export function createJobRepository(driver,{crypto,ids,clock,principal}){
 principal=clone(principal);if(principal.kind!=='operator')throw new TypeError('Job operator required.');name(principal.id,'operator');
 const nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec') * 1000 AS INTEGER)";
 const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='jobs-runner' AND enabled=1)";
 const hash=value=>crypto.sha256(utf8(boundedJson(value)));
 const read=async statements=>(await driver.batch(statements)).map(x=>x.rows);
 const getRow=async id=>(await read([sql('SELECT * FROM app_jobs WHERE id=? AND principal=?',id,principal.id)]))[0][0];
 const leaseWhere=`id=? AND principal=? AND state='running' AND lease_token=? AND revision=? AND payload_digest=? AND lease_until_ms>${nowSql} AND lease_until_ms>? AND ${grant}`;
 const leaseValues=lease=>[lease.jobId,principal.id,lease.token,Number(lease.revision),lease.payloadDigest,nat(clock.nowMs(),'clock'),principal.id];
 async function reconcileWrite(statements,resolve){
  try{await driver.batch(statements);}catch(error){try{const resolved=await resolve();if(resolved)return resolved;}catch{}return pending('write-outcome-unknown');}
  return (await resolve())??conflict('lease-or-revision-conflict');
 }
 return Object.freeze({
  principal:Object.freeze(clone(principal)),
  async readJob(id){name(id,'job');return jobFromRow(await getRow(id));},
  async enqueue(value){
   const c=clone(value);validateJobInput(c.input);name(c.requestKey,'request key');nat(c.nowMs,'now');
   if(c.operationKind!=='jobs.enqueue.v1'||canonicalJson(c.principal)!==canonicalJson(principal)||c.businessIdentity!==c.input.businessKey||c.requestDigest!==await crypto.sha256(jobRequestBytes(c)))throw new TypeError('Invalid job command.');
   const existing=async()=>{const [rows]=await read([sql('SELECT * FROM app_jobs WHERE business_key=? OR source_key=? OR (principal=? AND request_key=?)',c.input.businessKey,c.input.sourceKey,principal.id,c.requestKey)]);
    if(!rows.length)return null;return rows.length===1&&rows[0].request_digest===c.requestDigest?{kind:'replayed',job:jobFromRow(rows[0])}:conflict('idempotency_conflict');};
   const prior=await existing();if(prior)return prior;
   const [versions]=await read([sql('SELECT * FROM app_revisions ORDER BY name')]),version=revisions(versions);
   if(!matchesExpectedRevisions(c.expectedRevisions,version))return conflict('revision_conflict');
   const payloadDigest=await hash(c.input.payload),id=ids.next(),i=c.input;
   const statement=sql(`INSERT INTO app_jobs(id,business_key,type,payload_json,payload_digest,principal,request_key,request_digest,expected_revisions,source_key,state,ready_ms,max_attempts,created_ms)
    SELECT ?,?,?,?,?,?,?,?,?,?,'queued',?,?,? WHERE ${grant}
     AND (SELECT revision FROM app_revisions WHERE name='earn')=? AND (SELECT revision FROM app_revisions WHERE name='source')=? AND (SELECT revision FROM app_revisions WHERE name='control')=?
     AND NOT EXISTS(SELECT 1 FROM app_jobs WHERE business_key=? OR source_key=? OR (principal=? AND request_key=?))`,
    id,i.businessKey,i.type,boundedJson(i.payload),payloadDigest,principal.id,c.requestKey,c.requestDigest,canonicalJson(version),i.sourceKey,i.readyMs,i.maxAttempts,c.nowMs,
    principal.id,Number(version.earn),Number(version.source),Number(version.control),i.businessKey,i.sourceKey,principal.id,c.requestKey);
   const result=await reconcileWrite([statement],existing);return result.kind==='replayed'&&result.job.id===id?{...result,kind:'committed'}:result;
  },
  async acquireJob({leaseMs=30000}={}){
   requireValue(Number.isInteger(leaseMs)&&leaseMs>=100&&leaseMs<=30000,'Lease duration outside local bounds.');
   const token=ids.next(),now=nat(clock.nowMs(),'clock');
   // Expired unknown work never becomes failed-and-repeatable on its own.
   const exhausted=sql(`UPDATE app_jobs SET state='held',reason='attempt-ceiling',dependency='manual-reconciliation',ready_ms=NULL,lease_token=NULL,lease_until_ms=NULL,finished_ms=${nowSql}
    WHERE id IN (SELECT id FROM app_jobs WHERE principal=? AND attempt>=max_attempts AND (state IN ('queued','retry') OR (state='running' AND lease_until_ms<=${nowSql})) ORDER BY id LIMIT 20) AND ${grant}`,principal.id,principal.id);
   const claim=sql(`UPDATE app_jobs SET state='running',lease_token=?,lease_started_ms=${nowSql},lease_until_ms=${nowSql}+?,revision=revision+1,attempt=attempt+1,reason=NULL,dependency=NULL,
    dependency_seq=(SELECT COALESCE(MAX(sequence),0) FROM app_settlement_dependencies)
    WHERE id=(SELECT id FROM app_jobs WHERE principal=? AND attempt<max_attempts AND ((state IN ('queued','retry','held') AND ready_ms IS NOT NULL AND ready_ms<=? AND ready_ms<=${nowSql})
     OR (state='running' AND lease_until_ms<=${nowSql})) ORDER BY COALESCE(ready_ms,0),id LIMIT 1) AND ${grant}`,token,leaseMs,principal.id,now,principal.id);
   const resolve=async()=>{const [rows]=await read([sql('SELECT * FROM app_jobs WHERE lease_token=?',token)]);return rows[0]?{kind:'acquired',job:jobFromRow(rows[0])}:null;};
   const result=await reconcileWrite([exhausted,claim],resolve);return result.kind==='conflict'?{kind:'idle'}:result;
  },
  async checkpoint(leaseValue,{sequence,value}){
   const lease=clone(leaseValue),text=boundedJson(value);nat(sequence,'checkpoint sequence');
   const result=await reconcileWrite([sql(`UPDATE app_jobs SET checkpoint_json=?,checkpoint_seq=checkpoint_seq+1 WHERE ${leaseWhere} AND checkpoint_seq=?`,text,...leaseValues(lease),sequence)],async()=>{
    const row=await getRow(lease.jobId);return row?.lease_token===lease.token&&row.checkpoint_seq===sequence+1&&row.checkpoint_json===text?{kind:'checkpointed',job:jobFromRow(row)}:null;});return result;
  },
  async finish(leaseValue,value){
   const lease=clone(leaseValue),outcome=clone(value);
   requireValue(['completed','held','retry','failed'].includes(outcome.state),'Invalid job outcome.');
   if(outcome.state==='failed')requireValue(outcome.certainty==='no-effect','Unknown effects cannot become failed-and-repeatable.');
   if(['retry','held'].includes(outcome.state)&&outcome.readyMs!==null)nat(outcome.readyMs,'ready time');
   const resultJson=boundedJson(outcome.result??null),resultDigest=await hash(outcome.result??null),reason=outcome.reason??null,dependency=outcome.dependency??null;
   const readyMs=['retry','held'].includes(outcome.state)?outcome.readyMs:null,wakeable=outcome.state==='held'&&dependency!==null;
   // A source can commit after the handler observed a missing dependency but
   // before this hold. Compare against the claim's event cursor atomically;
   // an event seen by an earlier claim never causes an automatic retry loop.
   const cte=wakeable?`WITH new_dependency AS (SELECT digest,ready_ms FROM app_settlement_dependencies
    WHERE dependency=? AND sequence>(SELECT dependency_seq FROM app_jobs WHERE id=?) ORDER BY sequence DESC LIMIT 1) `:'';
   const choose=(event,fallback)=>wakeable?`CASE WHEN EXISTS(SELECT 1 FROM new_dependency) THEN ${event} ELSE ${fallback} END`:fallback;
   const statement=sql(`${cte}UPDATE app_jobs SET state=${choose("'queued'",'?')},ready_ms=${choose('(SELECT ready_ms FROM new_dependency)','?')},
    reason=${choose('NULL','?')},dependency=${choose('NULL','?')},wake_digest=${choose('(SELECT digest FROM new_dependency)','wake_digest')},
    result_json=?,result_digest=?,lease_token=NULL,lease_until_ms=NULL,finished_ms=${nowSql} WHERE ${leaseWhere}`,
    ...(wakeable?[dependency,lease.jobId]:[]),outcome.state,readyMs,reason,dependency,resultJson,resultDigest,...leaseValues(lease));
   return reconcileWrite([statement],async()=>{
    const row=await getRow(lease.jobId);if(row?.revision!==Number(lease.revision)||row.result_digest!==resultDigest)return null;
    if(row.state===outcome.state&&row.reason===reason&&row.dependency===dependency&&row.ready_ms===readyMs)return {kind:'finished',job:jobFromRow(row)};
    if(wakeable&&row.state==='queued'&&row.reason===null&&row.dependency===null){
     const [events]=await read([sql(`SELECT 1 FROM app_settlement_dependencies WHERE dependency=? AND digest=? AND ready_ms=? AND sequence>?`,dependency,row.wake_digest,row.ready_ms,row.dependency_seq)]);
     if(events.length)return {kind:'finished',job:jobFromRow(row)};
    }return null;
   });
  },
  async wake({jobId,dependency,evidenceDigest}){
   name(jobId,'job');name(dependency,'dependency');requireValue(/^[a-f0-9]{64}$/.test(evidenceDigest),'Invalid evidence digest.');
   const now=nat(clock.nowMs(),'clock'),token=ids.next();
   const rows=await driver.batch([sql(`INSERT INTO app_job_events SELECT id,?,?,? FROM app_jobs WHERE id=? AND principal=? AND state='held' AND dependency=? AND ${grant} ON CONFLICT DO NOTHING`,dependency+':'+evidenceDigest,evidenceDigest,token,jobId,principal.id,dependency,principal.id),
    sql(`UPDATE app_jobs SET state='queued',ready_ms=?,wake_digest=?,reason=NULL,dependency=NULL WHERE id=? AND principal=? AND state='held' AND dependency=? AND wake_digest IS NOT ?
     AND EXISTS(SELECT 1 FROM app_job_events WHERE job_id=? AND event_key=? AND wake_token=?) AND ${grant}`,now,evidenceDigest,jobId,principal.id,dependency,evidenceDigest,jobId,dependency+':'+evidenceDigest,token,principal.id)]);
   return {kind:rows[1].changes?'woken':'unchanged',job:jobFromRow(await getRow(jobId))};
  },
 });
}
