import {sql,revisions,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {allocationWindow} from '../domain/earn/index.mjs';
import {COMMIT_ALLOCATION,settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {settlementOutbox} from './settlement-outbox.mjs';
import {clone} from './model.mjs';
import {name,requireValue} from '../earn/validation.mjs';
// Private manual scheduling seam. It records all ten original activation dates,
// including future work, without cron, provider calls or financial execution.
export function createSettlementScheduler(driver,{crypto,principal}){
 const operator=clone(principal);requireValue(operator.kind==='operator','Operator required.');name(operator.id,'operator');
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 return Object.freeze({async scheduleCampaigns({after='',limit=10}={}){
  requireValue(typeof after==='string'&&after.length<=256&&Number.isInteger(limit)&&limit>=1&&limit<=10,'Invalid schedule cursor or bound.');
  const [versionRows,campaigns,grants,recovered]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
   sql('SELECT token_id,activation_ms FROM earn_fixture_campaigns WHERE token_id>? ORDER BY token_id LIMIT ?',after,limit+1),
   sql("SELECT scope FROM app_operator_scopes WHERE operator=? AND scope IN ('jobs-runner','earn-settlement') AND enabled=1",operator.id),
   sql('SELECT 1 FROM earn_recovered_boards LIMIT 1')]);
  if(grants.length!==2)return {kind:'conflict',code:'operator_scope_required'};
  if(recovered.length)return {kind:'conflict',code:'read_only_archive'};
  const versions=revisions(versionRows),selected=campaigns.slice(0,limit),outboxes=[];
  for(const c of selected)for(let day=1;day<=10;day++){
   const identity={tokenId:c.token_id,day},window=allocationWindow(c.activation_ms,day);
   outboxes.push(await settlementOutbox({principal:operator,businessKey:settlementFenceKey(COMMIT_ALLOCATION,identity),type:'allocate-token-day',payload:identity,readyMs:window.startsAtMs},crypto));
  }
  if(!outboxes.length)return {kind:'scheduled',count:0,next:null};
  const gate=`(SELECT COUNT(*) FROM app_operator_scopes WHERE operator=? AND scope IN ('jobs-runner','earn-settlement') AND enabled=1)=2
   AND (SELECT revision FROM app_revisions WHERE name='earn')=? AND (SELECT revision FROM app_revisions WHERE name='source')=?
   AND (SELECT revision FROM app_revisions WHERE name='control')=? AND NOT EXISTS(SELECT 1 FROM earn_recovered_boards)`;
  const statements=outboxes.map(o=>o.statement(gate,[operator.id,Number(versions.earn),Number(versions.source),Number(versions.control)]));
  measureBatch(statements);
  let failure;try{await driver.batch(statements);}catch(error){failure=error;}
  const [rows]=await read([sql('SELECT source_key,command_json,request_digest FROM app_job_outbox WHERE source_key IN (SELECT value FROM json_each(?))',JSON.stringify(outboxes.map(o=>o.sourceKey)))]);
  const same=outboxes.every(o=>rows.some(r=>r.source_key===o.sourceKey&&r.request_digest===o.command.requestDigest&&r.command_json===canonicalJson(o.command)));
  if(!same)return failure?{kind:'pending',reason:'schedule-outcome-unknown'}:{kind:'conflict',code:'schedule_revision_or_identity_conflict'};
  return {kind:'scheduled',count:outboxes.length,next:campaigns.length>limit?selected.at(-1).token_id:null};
 }});
}
