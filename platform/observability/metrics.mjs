import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {historicalUsageSql,historicalSpendSql} from '../storage/atomic-operations.mjs';
import {pressureFromRows,decisionFromRows,controlledScopes,protectedScopes} from '../operations/portable-controls.mjs';
import {utf8,canonicalJson} from '../security/canonical.mjs';
export const OPERATIONAL_METRIC_LIMITS=Object.freeze({statements:24,rows:256,resultBytes:65536,outputBytes:16384});
const groups={jobs:['queued','running','held','retry','completed','failed'],commands:['staging','committed'],evidence:['verified','pending','incompatible','invalid'],publications:['planned','verified','published','held'],notices:['queued','leased','retry','delivered','unknown','cancelled'],recovery:['restoring','ready','held']};
const need=(v)=>{if(!v)throw Error('Invalid operational snapshot.');},nat=v=>Number.isSafeInteger(v)&&v>=0;
const quote=v=>"'"+v+"'";
function grouped(table,column,states,where='1=1',oldest=null,extra=''){return sql(`SELECT CASE WHEN ${column} IN (${states.map(quote).join(',')}) THEN ${column} ELSE 'unexpected-state' END state,COUNT(*) count${oldest?`,MIN(${oldest}) oldestMs`:''}${extra} FROM ${table} WHERE ${where} GROUP BY 1 LIMIT ${states.length+1}`);}
function counts(rows,states){const value=Object.fromEntries(states.map(s=>[s,0]));for(const row of rows){need(states.includes(row.state)&&nat(row.count));value[row.state]=row.count;}return value;}
function single(rows){need(rows.length===1);return rows[0];}
function money(v){return typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v);}
function safeNumber(row,key){const value=row[key];need(nat(value));return value;}
function frozen(v){if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;}
/** One atomic local read snapshot. This reports observed rows, not test-suite
 * success, chain provenance, billed resource usage or launch authorization. */
export function createOperationalMetrics({driver,clock}){
 return Object.freeze({async read(){
  const asOfMs=clock.nowMs(),base={scope:'local-fixture',asOfMs,financialExecution:false};if(!nat(asOfMs)||asOfMs>8640000000000000)throw new TypeError('Invalid metrics clock.');const epoch=Math.floor(asOfMs/86400000),usage=historicalUsageSql(asOfMs),spend=historicalSpendSql(asOfMs);
  const statements=[
   sql('SELECT revision FROM app_recovery_watermark WHERE id=1'),
   sql('SELECT staffed_minutes,seconds_per_review,admission_limit FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=? ORDER BY effective_epoch DESC,recorded_ms DESC LIMIT 1',epoch,asOfMs),
   sql('SELECT COALESCE((SELECT admitted FROM earn_admission_counts WHERE epoch=?),0) admitted',epoch),
   sql('SELECT COUNT(*) closed FROM earn_boards WHERE epoch=?',epoch),
   sql("SELECT paused FROM ops_scope_log WHERE scope='earn-admission' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",asOfMs),
   sql(`SELECT 'redacted-provider' provider,CASE WHEN metric IN ('new-monthly-usd','daily-provider-units') THEN metric ELSE 'invalid' END metric,CASE WHEN length(period)<=10 THEN period ELSE NULL END period,CASE WHEN length(measured)<=80 THEN measured ELSE NULL END measured,CASE WHEN length(quota)<=80 THEN quota ELSE NULL END quota FROM (${usage.sql})`,...usage.values),
   sql(`SELECT at_ms,settled_ms,status,CASE WHEN length(limit_usd_micros)<=80 THEN limit_usd_micros ELSE NULL END limit_usd_micros,CASE WHEN length(actual_usd_micros)<=80 THEN actual_usd_micros ELSE NULL END actual_usd_micros FROM (${spend.sql})`,...spend.values),
   grouped('app_jobs','state',groups.jobs,'1=1','created_ms'),
   sql("SELECT COUNT(*) started,COALESCE(SUM(CASE WHEN ended_ms IS NULL THEN 1 ELSE 0 END),0) unresolved,COALESCE(SUM(CASE WHEN outcome='failed' THEN 1 ELSE 0 END),0) failed FROM app_job_attempts"),
   sql('SELECT COUNT(*) quotaAdmissions FROM app_provider_attempts'),
   grouped('app_command_receipts','state',groups.commands),
   grouped('app_evidence_heads h JOIN app_evidence_receipts r ON r.receipt_digest=h.receipt_digest','r.status',groups.evidence,'1=1','r.recorded_ms'),
   grouped('app_artifact_publications','state',groups.publications),
   grouped('notice_outbox','state',groups.notices,'1=1','created_ms',',SUM(attempts) leaseClaims,SUM(CASE WHEN typeof(attempts)=\'integer\' AND attempts BETWEEN 0 AND 5 THEN 0 ELSE 1 END) invalidAttempts'),
   sql('SELECT COUNT(*) deliveredEffects FROM notice_inbox'),
   grouped('app_recovery_runs','state',groups.recovery,"mode='private'"),
   sql('SELECT mode,status FROM app_recovery_state WHERE id=1'),
   sql('SELECT (SELECT COUNT(*) FROM app_private_artifacts) privateObjects,(SELECT COALESCE(SUM(size),0) FROM app_private_artifacts) privateBytes,(SELECT COUNT(*) FROM manifest_catalog) publicObjects,(SELECT COALESCE(SUM(size_bytes),0) FROM manifest_catalog) publicBytes'),
   sql('SELECT COUNT(*) admittedSubmissions,COALESCE(SUM(CASE WHEN r.submission_id IS NULL THEN 1 ELSE 0 END),0) awaitingFinalReview,COALESCE(SUM(CASE WHEN r.content_score=0 THEN 1 ELSE 0 END),0) contentRejected FROM earn_submissions s LEFT JOIN earn_reviews r ON r.submission_id=s.id WHERE s.epoch=?',epoch),
   sql("SELECT COUNT(*) finalizedBoardsWithoutPublicationReceipt FROM earn_boards b WHERE NOT EXISTS(SELECT 1 FROM app_artifact_publications p WHERE p.epoch=b.epoch AND p.state='published')"),
   sql('SELECT COUNT(*) unassignedSourceJobs FROM app_job_outbox WHERE job_id IS NULL'),
   sql('SELECT revision FROM app_recovery_watermark WHERE id=1')
  ];
  need(statements.length<=OPERATIONAL_METRIC_LIMITS.statements);measureBatch(statements);
  try{
   const result=await driver.batch(statements);need(Array.isArray(result)&&result.length===statements.length);const rows=result.map(r=>{need(Array.isArray(r.rows));return r.rows;});if(rows.reduce((sum,r)=>sum+r.length,0)>OPERATIONAL_METRIC_LIMITS.rows||utf8(canonicalJson(rows)).length>OPERATIONAL_METRIC_LIMITS.resultBytes)return {...base,kind:'pending',reason:'metrics-result-bound'};
   const watermark=single(rows[0]).revision;need(nat(watermark)&&single(rows[21]).revision===watermark);const state=single(rows[16]);need(['live','public','private'].includes(state.mode)&&['live','restoring','ready','held'].includes(state.status));
   const jobs=counts(rows[7],groups.jobs),commands=counts(rows[10],groups.commands),evidence=counts(rows[11],groups.evidence),publications=counts(rows[12],groups.publications),notices=counts(rows[13],groups.notices),recoveries=counts(rows[15],groups.recovery);
   const quotaAdmissions=safeNumber(single(rows[9]),'quotaAdmissions'),attempts=single(rows[8]);for(const k of ['started','unresolved','failed'])safeNumber(attempts,k);const storage=single(rows[17]);need(Object.keys(storage).sort().join(',')==='privateBytes,privateObjects,publicBytes,publicObjects');for(const k of Object.keys(storage))safeNumber(storage,k);const submissions=single(rows[18]);need(Object.keys(submissions).sort().join(',')==='admittedSubmissions,awaitingFinalReview,contentRejected');for(const k of Object.keys(submissions))safeNumber(submissions,k);
   const usageRows=rows[5],spendRows=rows[6];let pressure;
   if(usageRows.length>100||spendRows.length>100)pressure={status:'pending',reason:'operating-input-bound'};
   else{need(usageRows.every(r=>['new-monthly-usd','daily-provider-units'].includes(r.metric)&&typeof r.period==='string'&&/^\d{4}-\d{2}(-\d{2})?$/.test(r.period)&&money(r.measured)&&(r.metric==='new-monthly-usd'||money(r.quota))));need(spendRows.every(r=>nat(r.at_ms)&&(r.settled_ms===null||nat(r.settled_ms))&&['reserved','settled'].includes(r.status)&&money(r.limit_usd_micros)&&(r.status==='reserved'||money(r.actual_usd_micros))));pressure=pressureFromRows(usageRows,spendRows,asOfMs);}
   const monthlyEvidence=usageRows.filter(r=>r.metric==='new-monthly-usd').length,costEvidenceAvailable=monthlyEvidence+spendRows.length>0;
   const budget=pressure.status==='ready'?{status:'ready',level:pressure.level,period:pressure.period,usageEvidenceAvailable:usageRows.length>0,costEvidenceAvailable,recordedCommitmentUsdMicros:costEvidenceAvailable?pressure.recurring.totalUsdMicros:null,policyAccountingUsdMicros:pressure.recurring.totalUsdMicros,limitUsdMicros:pressure.recurring.limitUsdMicros,actualExternalCostUsdMicros:null,actualExternalCostStatus:'unknown',providerQuotaStates:pressure.providers.map(r=>r.status),pendingReservations:spendRows.filter(r=>r.status==='reserved'||r.settled_ms>asOfMs).length}: {status:'pending',reason:pressure.reason,usageEvidenceAvailable:usageRows.length>0,costEvidenceAvailable,actualExternalCostUsdMicros:null,actualExternalCostStatus:'unknown'};
   const admitted=safeNumber(single(rows[2]),'admitted'),closed=safeNumber(single(rows[3]),'closed')>0,policy=rows[1][0];need(rows[1].length<=1&&rows[4].length<=1);if(policy)need(nat(policy.staffed_minutes)&&nat(policy.seconds_per_review)&&policy.seconds_per_review>0&&nat(policy.admission_limit)&&policy.admission_limit<=100);const limit=policy?Math.min(policy.admission_limit,Math.floor(policy.staffed_minutes*60/policy.seconds_per_review)):0,paused=rows[4][0]?.paused??0;need(paused===0||paused===1);
   const staffing={epoch,configured:!!policy,limit,admitted,remaining:Math.max(0,limit-admitted),paused:!!paused,closed};
   const noticeLeaseClaims=rows[13].reduce((n,r)=>{need(nat(r.leaseClaims)&&r.invalidAttempts===0);return n+r.leaseClaims;},0);need(nat(noticeLeaseClaims));
   const oldestRecorded=values=>{need(values.every(v=>nat(v)&&v<=asOfMs));return values.length?Math.min(...values):null;};
   const oldestHeadRecordedMs=oldestRecorded(rows[11].map(r=>r.oldestMs)),oldestOutstandingCreatedMs=oldestRecorded(rows[13].filter(r=>['queued','leased','retry','unknown'].includes(r.state)).map(r=>r.oldestMs)),oldestUnknownCreatedMs=oldestRecorded(rows[13].filter(r=>r.state==='unknown').map(r=>r.oldestMs));
   const age=at=>at===null?null:asOfMs-at;
   const oldestHeld=rows[7].filter(r=>['held','retry'].includes(r.state)).map(r=>r.oldestMs);need(oldestHeld.every(nat));const oldestHeldAtMs=oldestHeld.length?Math.min(...oldestHeld):null;
   const output={...base,kind:'ready',watermark:String(watermark),staffing,budget,jobs:{...jobs,oldestHeldAtMs,oldestHeldAgeMs:oldestHeldAtMs===null?null:Math.max(0,asOfMs-oldestHeldAtMs),unassignedSourceJobs:safeNumber(single(rows[20]),'unassignedSourceJobs')},attempts:{noticeLeaseClaims,noticeLeaseClaimsCoverage:'retained-outbox-rows-only',noticeLifetimeAttemptsStatus:'unknown-purged-history-not-counted',quotaAdmissions,startedJobAttempts:attempts.started,unresolvedJobAttempts:attempts.unresolved,failedJobAttempts:attempts.failed,actualProviderCalls:null,actualProviderCallsStatus:'unknown'},effects:{deliveredInboxCoverage:'retained-inbox-rows-only',committedCommands:commands.committed,unresolvedCommands:commands.staging,deliveredInboxEffects:safeNumber(single(rows[14]),'deliveredEffects')},evidence:{...evidence,recordingAge:{oldestRecordedAtMs:oldestHeadRecordedMs,oldestRecordedAgeMs:age(oldestHeadRecordedMs),coverage:'current-head-receipts-only',sourceObservationAgeStatus:'unknown'}},publications:{...publications,coverage:'guarded-publication-receipts-only',finalizedBoardsWithoutPublicationReceipt:safeNumber(single(rows[19]),'finalizedBoardsWithoutPublicationReceipt')},notices:{...notices,age:{oldestOutstandingCreatedAtMs:oldestOutstandingCreatedMs,oldestOutstandingCreatedAgeMs:age(oldestOutstandingCreatedMs),oldestUnknownCreatedAtMs:oldestUnknownCreatedMs,oldestUnknownCreatedAgeMs:age(oldestUnknownCreatedMs),coverage:'retained-outbox-creation-times-only',heldSinceMs:null,unknownSinceMs:null,transitionAgeStatus:'unknown-no-retained-transition-time'}},recovery:{mode:state.mode,status:state.status,coverage:'private-runs-only',runs:recoveries},storage:{...storage,measurement:'retained-catalog-bytes-not-billed-storage'},submissions:{...submissions,admissionAttemptHistoryStatus:'unknown-no-durable-attempt-history',observedCoverage:'current-epoch-retained-submissions-and-reviews',refusedAdmissions:null,pendingAdmissionAttempts:null},protectedRecovery:protectedScopes.map(scope=>decisionFromRows(scope,null,pressure)),optionalWork:controlledScopes.filter(s=>s.startsWith('optional-')).map(scope=>{const d=decisionFromRows(scope,null,pressure);return {scope,allowedByBudget:d.allowed,reason:d.reason,currentScopePauseNotIncluded:true};})};
   if(utf8(canonicalJson(output)).length>OPERATIONAL_METRIC_LIMITS.outputBytes)return {...base,kind:'pending',reason:'metrics-output-bound'};return frozen(output);
  }catch{return {...base,kind:'pending',reason:'metrics-snapshot-unavailable'};}
 }});
}
