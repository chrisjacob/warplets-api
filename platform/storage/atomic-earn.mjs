import { canonicalJson, utf8 } from '../security/canonical.mjs';
import { ADMIT_SUBMISSION, FINAL_REVIEW, admissionRequestBytes, reviewRequestBytes } from '../application/commands.mjs';
import { canonicalContentUrl, name, nat, requireValue } from '../earn/validation.mjs';
import { DAY_MS, MIN_STAKE_MICRO_USD } from '../domain/earn/index.mjs';
import { sql, revisions, measureBatch } from './atomic-driver.mjs';
const pending=(reason)=>({kind:'pending',reason,dependencyIds:[]});
const conflict=code=>({kind:'conflict',code});
const principalKey=p=>p.kind+':'+(p.kind==='wallet'?p.wallet:p.id);
const selectedReceipt=(command)=>sql('SELECT * FROM app_command_receipts WHERE principal_key=? AND operation_kind=? AND request_key=?',
  principalKey(command.principal),command.operationKind,command.requestKey);
function recovered(row,command) {
  if(!row)return null;
  if(row.request_digest!==command.requestDigest)return conflict('idempotency_conflict');
  if(row.state!=='committed')return pending('command-incomplete');
  return {kind:'replayed',receipt:{operationId:row.operation_id,principal:command.principal,operationKind:row.operation_kind,
    businessIdentity:row.business_key,requestKey:row.request_key,requestDigest:row.request_digest,
    expectedRevisions:JSON.parse(row.expected_revisions),outputDigest:row.output_digest,status:'committed',resultRef:row.result_ref},value:JSON.parse(row.result_json)};
}
function costHeld(usage,spend,nowMs) {
  if(usage.length>100||spend.length>100)return 'operating-input-bound';
  const month=new Date(nowMs).toISOString().slice(0,7),day=new Date(nowMs).toISOString().slice(0,10);
  const monthStart=Date.parse(month+'-01T00:00:00Z');
  let total=0n;
  for(const row of usage) {
    if(row.metric==='new-monthly-usd')total+=BigInt(row.measured);
    else if(row.period===day&&BigInt(row.measured)>=BigInt(row.quota))return 'budget-limit';
  }
  for(const row of spend) {
    const when=row.settled_ms??row.at_ms;
    if(row.status==='reserved'||when>nowMs)total+=BigInt(row.limit_usd_micros);
    else if(when>=monthStart)total+=BigInt(row.actual_usd_micros);
  }
  return total>=5000000n?'budget-limit':null;
}
/** @param {object} driver
 * @param {{crypto:import('../application/ports.ts').CanonicalCrypto,ids:{next():string},telemetry?:import('../application/ports.ts').AppTelemetry}} ports */
export function createAtomicEarnRepository(driver,{crypto,ids,telemetry={record(){}}}) {
  const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
  async function read(statements) {return (await driver.batch(statements)).map(r=>r.rows);}
  async function replay(command) {return recovered((await read([selectedReceipt(command)]))[0][0],command);}
  async function execute(command,{businessKey,input,result,resultRef,version,child,authoritySql='1',authorityValues=[]}) {
    const operationId=ids.next(),nonce=ids.next(),outputDigest=await hash(result);
    const identity=[operationId,principalKey(command.principal),command.operationKind,businessKey,command.requestKey,command.requestDigest,
      canonicalJson(version),nonce,canonicalJson(input),canonicalJson(result),outputDigest,resultRef,command.nowMs];
    const claim=sql(`INSERT INTO app_command_receipts
      (operation_id,principal_key,operation_kind,business_key,request_key,request_digest,expected_revisions,claim_nonce,state,input_json,result_json,output_digest,result_ref,created_ms)
      SELECT ?,?,?,?,?,?,?,?,'staging',?,?,?,?,?
      WHERE (SELECT revision FROM app_revisions WHERE name='earn')=?
       AND (SELECT revision FROM app_revisions WHERE name='source')=?
       AND (SELECT revision FROM app_revisions WHERE name='control')=?
       AND NOT EXISTS(SELECT 1 FROM app_command_receipts WHERE (principal_key=? AND operation_kind=? AND request_key=?) OR (operation_kind=? AND business_key=?))
       AND (${authoritySql})`,...identity,Number(version.earn),Number(version.source),Number(version.control),
       principalKey(command.principal),command.operationKind,command.requestKey,command.operationKind,businessKey,...authorityValues);
    const gate="EXISTS(SELECT 1 FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging')";
    const statements=[claim,child(gate,[operationId,nonce]),sql("UPDATE app_command_receipts SET state='committed' WHERE operation_id=? AND claim_nonce=? AND state='staging'",operationId,nonce)];
    telemetry.record('atomic-batch',measureBatch(statements));
    let results;
    try {results=await driver.batch(statements);}
    catch(error) {
      // A response can be lost after commit; resolve the stable identity before
      // surfacing the transport error. Never invent success on missing receipt.
      const resolved=await replay(command);
      if(resolved)return resolved;
      throw error;
    }
    const outcome=await replay(command);
    if(outcome?.kind==='replayed')return {...outcome,kind:results[0].changes===1?'committed':'replayed'};
    if(outcome)return outcome;
    return conflict('revision_conflict');
  }
  return Object.freeze({
    async admitSubmission(command) {
      const {principal,input,nowMs}=command;
      if(principal?.kind!=='wallet'||command.operationKind!==ADMIT_SUBMISSION)throw new TypeError('Invalid admission identity.');
      name(principal.wallet,'wallet');name(input.tokenId,'token');nat(nowMs,'now');
      requireValue(typeof command.requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(command.requestKey),'Invalid request key.');
      if(command.businessIdentity!==principal.wallet+'/'+input.tokenId||input.url!==canonicalContentUrl(input.url)||command.requestDigest!==await crypto.sha256(admissionRequestBytes(command)))throw new TypeError('Invalid admission digest.');
      const prior=await replay(command);if(prior)return prior;
      const epoch=Math.floor(nowMs/DAY_MS);
      const rows=await read([
        sql('SELECT * FROM app_revisions ORDER BY name'),
        sql('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?',input.tokenId),
        sql('SELECT 1 FROM earn_boards WHERE epoch=?',epoch),
        sql('SELECT 1 FROM earn_submissions WHERE epoch=? AND wallet=? AND token_id=?',epoch,principal.wallet,input.tokenId),
        sql('SELECT * FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=? ORDER BY effective_epoch DESC,recorded_ms DESC LIMIT 1',epoch,nowMs),
        sql('SELECT admitted FROM earn_admission_counts WHERE epoch=?',epoch),
        sql("SELECT paused FROM ops_scope_log WHERE scope='earn-admission' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",nowMs),
        sql(`SELECT r.id,r.micro_usd,o.decision FROM price_observations o LEFT JOIN earn_stake_reads r ON r.id=o.read_id
          WHERE o.wallet=? AND o.token_id=? AND o.as_of_ms<=? ORDER BY o.as_of_ms DESC,o.revision DESC LIMIT 1`,principal.wallet,input.tokenId,nowMs),
        sql(`SELECT * FROM ops_usage u WHERE u.at_ms<=? AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider
          AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms AND n.at_ms<=?) ORDER BY u.provider LIMIT 101`,nowMs,nowMs),
        sql("SELECT * FROM ops_optional_spend WHERE at_ms<=? AND (status='reserved' OR settled_ms>=?) LIMIT 101",nowMs,Date.parse(new Date(nowMs).toISOString().slice(0,7)+'-01T00:00:00Z')),
      ]);
      const [versionsRows,campaign,board,duplicate,policies,counts,scope,observations,usage,spend]=rows;
      if(!campaign[0]||nowMs<campaign[0].activation_ms||nowMs>=campaign[0].activation_ms+10*DAY_MS)return conflict('campaign_inactive');
      if(board.length)return conflict('board_closed');if(duplicate.length)return conflict('already_submitted');
      if(scope[0]?.paused)return pending('operator-pause');
      const held=costHeld(usage,spend,nowMs);if(held)return pending(held);
      const policy=policies[0];if(!policy)return pending('staffing-required');
      const limit=Math.min(policy.admission_limit,Math.floor(policy.staffed_minutes*60/policy.seconds_per_review));
      if((counts[0]?.admitted??0)>=limit)return conflict('board_capacity');
      const observation=observations[0],decision=observation?JSON.parse(observation.decision):null;
      if(!observation?.id||decision?.status!=='verified'||decision.expiresMs<nowMs)return pending('stake-evidence');
      if(BigInt(observation.micro_usd)<MIN_STAKE_MICRO_USD)return conflict('stake_ineligible');
      const id=ids.next(),value={submission:{id,tokenId:input.tokenId,epoch,url:input.url,submittedAtMs:nowMs},replay:false};
      return await execute(command,{businessKey:canonicalJson([principal.wallet,input.tokenId,epoch]),
        input:{wallet:principal.wallet,...input,epoch,entryReadId:observation.id},result:value,resultRef:id,version:revisions(versionsRows),
        child:(gate,values)=>sql(`INSERT INTO earn_submissions SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
          id,principal.wallet,input.tokenId,epoch,input.url,nowMs,observation.id,command.requestKey,...values)});
    },
    async recordFinalReview(command) {
      const {principal,input,nowMs}=command;
      if(principal?.kind!=='operator'||command.operationKind!==FINAL_REVIEW)throw new TypeError('Invalid review identity.');
      name(principal.id,'operator');nat(nowMs,'now');
      for(const key of ['submissionId','reason','sourceRef'])name(input[key],key);
      requireValue(Number.isInteger(input.score)&&input.score>=0&&input.score<=10,'Invalid score.');
      if(command.businessIdentity!==input.submissionId||command.requestKey!==input.submissionId||command.requestDigest!==await crypto.sha256(reviewRequestBytes(command)))throw new TypeError('Invalid review digest.');
      const prior=await replay(command);if(prior)return prior;
      const [versionsRows,posts,reviews,closed,grants]=await read([
        sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM earn_submissions WHERE id=?',input.submissionId),
        sql('SELECT 1 FROM earn_reviews WHERE submission_id=?',input.submissionId),
        sql('SELECT 1 FROM earn_boards WHERE epoch=(SELECT epoch FROM earn_submissions WHERE id=?) OR epoch=?',input.submissionId,Math.floor(nowMs/DAY_MS)),
        sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-review'",principal.id),
      ]);
      if(!posts[0]||nowMs<posts[0].submitted_ms)return conflict('invalid_review_time');
      if(reviews.length)return conflict('final_review');if(closed.length)return conflict('board_closed');
      if(!grants[0]?.enabled)return conflict('operator_scope_required');
      return await execute(command,{businessKey:input.submissionId,input:{...input,moderator:principal.id},result:{recorded:true,replayed:false},
        resultRef:input.submissionId,version:revisions(versionsRows),
        authoritySql:"EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-review' AND enabled=1)",authorityValues:[principal.id],
        child:(gate,values)=>sql(`INSERT INTO earn_reviews SELECT ?,?,?,?,?,? WHERE ${gate}`,
          input.submissionId,input.score,principal.id,input.reason,nowMs,input.sourceRef,...values)});
    },
    getBookmark(){return driver.getBookmark();},
  });
}
