import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {clone,jobRequestBytes,validateJobInput} from './model.mjs';
// Storage-internal named statement builder for source repository atomic batches.
// Callers must gate this effect with the same fresh source-command attempt.
export async function sourceJobOutboxStatement(commandValue,{crypto,gate,values}){
 const command=clone(commandValue);validateJobInput(command.input);
 if(command.operationKind!=='jobs.enqueue.v1'||command.requestDigest!==await crypto.sha256(jobRequestBytes(command)))throw new TypeError('Invalid outbox command.');
 return sql(`INSERT INTO app_job_outbox(source_key,command_json,request_digest) SELECT ?,?,? WHERE ${gate}`,
  command.input.sourceKey,canonicalJson(command),command.requestDigest,...values);
}
export async function reconcileJobOutbox(driver,repository,{limit=20}={}){
 if(!Number.isInteger(limit)||limit<1||limit>20)throw new TypeError('Outbox limit must be1–20.');
 if(repository.principal?.kind!=='operator')throw new TypeError('Outbox runner principal required.');
 const [selected]=await driver.batch([sql(`SELECT * FROM app_job_outbox WHERE job_id IS NULL
  AND json_extract(command_json,'$.principal.kind')='operator' AND json_extract(command_json,'$.principal.id')=? ORDER BY source_key LIMIT ?`,repository.principal.id,limit)]),items=[];
 for(const row of selected.rows){
  const command=JSON.parse(row.command_json),result=await repository.enqueue(command);items.push(result);
  if(!['committed','replayed'].includes(result.kind))continue;
  // The complete recorded command digest and source identity must agree.
  await driver.batch([sql(`UPDATE app_job_outbox SET job_id=? WHERE source_key=? AND request_digest=? AND job_id IS NULL
   AND EXISTS(SELECT 1 FROM app_jobs WHERE id=? AND source_key=? AND request_digest=?)`,result.job.id,row.source_key,row.request_digest,result.job.id,row.source_key,row.request_digest)]);
 }
 return {processed:items.length,items};
}
