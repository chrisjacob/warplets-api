import {createJobCommand} from './model.mjs';
import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
// Deterministic compact intent; source transaction makes the obligation durable.
export async function settlementOutbox({principal,businessKey,type,payload,readyMs},crypto){
 const command=await createJobCommand({principal,requestKey:businessKey,nowMs:readyMs,
  input:{businessKey,sourceKey:businessKey,type,payload:{principal,...payload},readyMs,maxAttempts:5}},crypto);
 return {sourceKey:businessKey,command,statement:(gate,v)=>sql(`INSERT INTO app_job_outbox(source_key,command_json,request_digest)
  SELECT ?,?,? WHERE ${gate} ON CONFLICT(source_key) DO NOTHING`,businessKey,canonicalJson(command),command.requestDigest,...v)};
}
// Persist dependency availability even while a consumer is running. A held
// consumer wakes here; a running consumer reconciles this event when holding.
// The source receipt gate and unique event key make commit retries harmless.
export function settlementWakeStatements({dependency,digest,nowMs},gate,v){
 const key=dependency+':'+digest;
 return [sql(`INSERT INTO app_settlement_dependencies(dependency,digest,ready_ms) SELECT ?,?,? WHERE ${gate}
   ON CONFLICT(dependency,digest) DO NOTHING`,dependency,digest,nowMs,...v),
  sql(`INSERT INTO app_job_events(job_id,event_key,payload_digest,wake_token)
  SELECT id,?,?,? FROM app_jobs WHERE state='held' AND dependency=? AND ${gate} ON CONFLICT DO NOTHING`,key,digest,v[0],dependency,...v),
  sql(`UPDATE app_jobs SET state='queued',ready_ms=?,wake_digest=?,reason=NULL,dependency=NULL
   WHERE state='held' AND dependency=? AND wake_digest IS NOT ? AND ${gate}
    AND EXISTS(SELECT 1 FROM app_job_events e WHERE e.job_id=app_jobs.id AND e.event_key=? AND e.wake_token=?)`,nowMs,digest,dependency,digest,...v,key,v[0])];
}
