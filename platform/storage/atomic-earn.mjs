import {prepareConfigAudit,configAuditStatement} from './atomic-audit.mjs';
import { pressureFromRows } from '../operations/portable-controls.mjs';
import { createAtomicReceipts } from './atomic-receipts.mjs';
import { canonicalJson, utf8 } from '../security/canonical.mjs';
import { ADMIT_SUBMISSION, FINAL_REVIEW, admissionRequestBytes, reviewRequestBytes } from '../application/commands.mjs';
import { canonicalContentUrl, name, nat, requireValue } from '../earn/validation.mjs';
import { DAY_MS, MIN_STAKE_MICRO_USD } from '../domain/earn/index.mjs';
import { sql, revisions, measureBatch, matchesExpectedRevisions } from './atomic-driver.mjs';
import {admissionRead} from '../pricing/admission-read.mjs';
const pending=(reason)=>({kind:'pending',reason,dependencyIds:[]});
const conflict=code=>({kind:'conflict',code});
function costHeld(usage,spend,nowMs) {
  const pressure=pressureFromRows(usage,spend,nowMs);
  return pressure.status==='pending'?pressure.reason:pressure.level==='limit'?'budget-limit':null;
}
/** @param {object} driver
 * @param {{crypto:import('../application/ports.ts').CanonicalCrypto,ids:{next():string},telemetry?:import('../application/ports.ts').AppTelemetry}} ports */
export function createAtomicEarnRepository(driver,{crypto,ids,telemetry={record(){}}}) {
  const {read,replay,execute}=createAtomicReceipts(driver,{crypto,ids,telemetry});
  return Object.freeze({
    async admitSubmission(command) {
      command=JSON.parse(canonicalJson(command));
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
        sql(`SELECT r.id,r.micro_usd,r.wallet AS read_wallet,r.token_id AS read_token,r.observed_ms AS read_observed_ms,r.expires_ms AS read_expires_ms,
          o.receipt,o.as_of_ms,o.policy_hash,p.policy_hash AS source_policy_hash,o.decision FROM price_observations o LEFT JOIN earn_stake_reads r ON r.id=o.read_id JOIN price_sources p ON p.token_id=o.token_id
          WHERE o.wallet=? AND o.token_id=? AND o.as_of_ms<=? ORDER BY o.as_of_ms DESC,o.revision DESC LIMIT 1`,principal.wallet,input.tokenId,nowMs),
        sql(`SELECT * FROM ops_usage u WHERE u.at_ms<=? AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider
          AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms AND n.at_ms<=?) AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,nowMs,nowMs,new Date(nowMs).toISOString().slice(0,10)),
        sql("SELECT * FROM ops_optional_spend WHERE at_ms<=? AND (status='reserved' OR COALESCE(settled_ms,at_ms)>=?) LIMIT 101",nowMs,Date.parse(new Date(nowMs).toISOString().slice(0,7)+'-01T00:00:00Z')),
        sql('SELECT 1 FROM earn_recovered_boards LIMIT 1'),
        sql('SELECT * FROM earn_submissions WHERE wallet=? AND request_key=?',principal.wallet,command.requestKey),
      ]);
      const [versionsRows,campaign,board,duplicate,policies,counts,scope,observations,usage,spend,recovered,accepted]=rows;
      if(!matchesExpectedRevisions(command.expectedRevisions,revisions(versionsRows)))return conflict('revision_conflict');
      if(accepted[0]){
        const row=accepted[0];if(row.token_id!==input.tokenId||row.url!==input.url)return conflict('idempotency_conflict');
        // Migration compatibility: adopt an already accepted reference result.
        // The mandatory effect assertion checks the original persisted row and
        // admission counter; no new submission or current-policy bypass occurs.
        return execute({...command,nowMs:row.submitted_ms},{businessKey:canonicalJson([principal.wallet,row.token_id,row.epoch]),
          input:{wallet:principal.wallet,...input,epoch:row.epoch,entryReadId:row.entry_read_id,adoptedReference:true},
          result:{submission:{id:row.id,tokenId:row.token_id,epoch:row.epoch,url:row.url,submittedAtMs:row.submitted_ms},replay:true},
          resultRef:row.id,version:revisions(versionsRows),child:()=>[]});
      }
      if(recovered.length)return conflict('read_only_archive');
      if(!campaign[0]||nowMs<campaign[0].activation_ms||nowMs>=campaign[0].activation_ms+10*DAY_MS)return conflict('campaign_inactive');
      if(board.length)return conflict('board_closed');if(duplicate.length)return conflict('already_submitted');
      if(scope[0]?.paused)return pending('operator-pause');
      const held=costHeld(usage,spend,nowMs);if(held)return pending(held);
      const policy=policies[0];if(!policy)return pending('staffing-required');
      const limit=Math.min(policy.admission_limit,Math.floor(policy.staffed_minutes*60/policy.seconds_per_review));
      if((counts[0]?.admitted??0)>=limit)return conflict('board_capacity');
      const observation=observations[0],decision=admissionRead(observation,{wallet:principal.wallet,tokenId:input.tokenId,nowMs});
      if(decision.status!=='verified')return pending('stake-evidence');
      if(BigInt(observation.micro_usd)<MIN_STAKE_MICRO_USD)return conflict('stake_ineligible');
      const id=ids.next(),value={submission:{id,tokenId:input.tokenId,epoch,url:input.url,submittedAtMs:nowMs},replay:false};
      return await execute(command,{businessKey:canonicalJson([principal.wallet,input.tokenId,epoch]),
        input:{wallet:principal.wallet,...input,epoch,entryReadId:observation.id},result:value,resultRef:id,version:revisions(versionsRows),
        child:(gate,values)=>sql(`INSERT INTO earn_submissions SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
          id,principal.wallet,input.tokenId,epoch,input.url,nowMs,observation.id,command.requestKey,...values)});
    },
    async recordFinalReview(command) {
      command=JSON.parse(canonicalJson(command));
      const {principal,input,nowMs}=command;
      if(principal?.kind!=='operator'||command.operationKind!==FINAL_REVIEW)throw new TypeError('Invalid review identity.');
      name(principal.id,'operator');nat(nowMs,'now');
      for(const key of ['submissionId','reason','sourceRef'])name(input[key],key);
      requireValue(Number.isInteger(input.score)&&input.score>=0&&input.score<=10,'Invalid score.');
      if(command.businessIdentity!==input.submissionId||command.requestKey!==input.submissionId||command.requestDigest!==await crypto.sha256(reviewRequestBytes(command)))throw new TypeError('Invalid review digest.');
      const prior=await replay(command);if(prior)return prior;
      const [versionsRows,posts,reviews,closed,grants,heads]=await read([
        sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM earn_submissions WHERE id=?',input.submissionId),
        sql('SELECT * FROM earn_reviews WHERE submission_id=?',input.submissionId),
        sql('SELECT 1 FROM earn_boards WHERE epoch=(SELECT epoch FROM earn_submissions WHERE id=?) OR epoch=?',input.submissionId,Math.floor(nowMs/DAY_MS)),
        sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-review'",principal.id),
        sql('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1'),
      ]);
      if(!matchesExpectedRevisions(command.expectedRevisions,revisions(versionsRows)))return conflict('revision_conflict');
      if(!posts[0]||nowMs<posts[0].submitted_ms)return conflict('invalid_review_time');
      const event={category:reviews.length?'final-review-adoption':'final-review',entity:input.submissionId,changeKey:command.requestKey,
        atMs:nowMs,actor:principal.id,evidenceRef:input.sourceRef,payload:{score:input.score,reason:input.reason,
          requestDigest:command.requestDigest,reviewedAtMs:reviews[0]?.reviewed_ms??nowMs,adoptedReference:reviews.length>0}};
      const audit=await prepareConfigAudit(heads[0],event,crypto);
      if(reviews.length){
        const row=reviews[0];
        if(row.content_score!==input.score||row.reason!==input.reason||row.source_ref!==input.sourceRef||row.moderator!==principal.id)return conflict('final_review');
        return execute({...command,nowMs:row.reviewed_ms},{businessKey:input.submissionId,input:{...input,moderator:principal.id,adoptedReference:true,audit},
          result:{recorded:true,replayed:true},resultRef:input.submissionId,version:revisions(versionsRows),child:(gate,values)=>configAuditStatement(audit,event,gate,values)});
      }
      if(closed.length)return conflict('board_closed');
      if(!grants[0]?.enabled)return conflict('operator_scope_required');
      return await execute(command,{businessKey:input.submissionId,input:{...input,moderator:principal.id,audit},result:{recorded:true,replayed:false},
        resultRef:input.submissionId,version:revisions(versionsRows),
        authoritySql:"EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-review' AND enabled=1)",authorityValues:[principal.id],
        child:(gate,values)=>[sql(`INSERT INTO earn_reviews SELECT ?,?,?,?,?,? WHERE ${gate}`,
          input.submissionId,input.score,principal.id,input.reason,nowMs,input.sourceRef,...values),configAuditStatement(audit,event,gate,values)]});
    },
    getBookmark(){return driver.getBookmark();},
  });
}
