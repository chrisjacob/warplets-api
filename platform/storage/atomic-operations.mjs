import { createAtomicReceipts } from './atomic-receipts.mjs';
import { canonicalJson,orderedJson,utf8 } from '../security/canonical.mjs';
import { name,nat,decimal,requireValue } from '../earn/validation.mjs';
import { sql,revisions } from './atomic-driver.mjs';
import { controlledScopes,protectedScopes,period,pressureFromRows,decisionFromRows } from '../operations/portable-controls.mjs';
export const OPERATIONS=Object.freeze({changeScope:'ops.change-scope.v1',configureWorkload:'ops.configure-workload.v1',
 reserveOptionalCost:'ops.reserve-cost.v1',settleOptionalCost:'ops.settle-cost.v1',meterProviderAttempt:'ops.meter-attempt.v1'});
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const fields={
 [OPERATIONS.changeScope]:['scope','paused','previousRevision','reason','evidenceRef'],
 [OPERATIONS.configureWorkload]:['effectiveEpoch','staffedMinutes','secondsPerReview','admissionLimit','reason'],
 [OPERATIONS.reserveOptionalCost]:['scope','upperUsdMicros','quoteRef'],
 [OPERATIONS.settleOptionalCost]:['reservationKey','actualUsdMicros','evidenceRef'],
 [OPERATIONS.meterProviderAttempt]:['attemptId','provider','units','quota','evidenceRef'],
};
const requestBytes=c=>utf8(canonicalJson([c.operationKind,c.principal.id,c.input,c.expectedRevisions]));
function business(kind,input,key,actor){
 if(kind===OPERATIONS.changeScope)return canonicalJson([input.scope,input.previousRevision]);
 if(kind===OPERATIONS.configureWorkload)return canonicalJson([actor,key]);
 if(kind===OPERATIONS.reserveOptionalCost)return key;
 if(kind===OPERATIONS.settleOptionalCost)return input.reservationKey;
 if(kind===OPERATIONS.meterProviderAttempt)return input.attemptId;
 throw new TypeError('Unknown operations command.');
}
export async function createOperationsCommand(operationKind,{principal,requestKey,input,nowMs,expectedRevisions={}},crypto){
 // Copy immutable request values before hashing. Runtime time is intentionally
 // absent from the digest, so an accepted retry survives later pauses/quotas.
 const command=JSON.parse(canonicalJson({operationKind,principal,requestKey,input,nowMs,expectedRevisions}));
 command.businessIdentity=business(operationKind,command.input,requestKey,principal.id);
 command.requestDigest=await crypto.sha256(requestBytes(command));
 return command;
}
const scope=scope=>requireValue(controlledScopes.includes(scope),'Choose a controllable application scope. Claims, principal and recovery are protected.');
const amount=(value,label)=>{requireValue(typeof value==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(value),'Invalid '+label+'.');return decimal(value,label);};
function usageSql(nowMs){return sql(`SELECT * FROM ops_usage u WHERE u.at_ms<=? AND NOT EXISTS(SELECT 1 FROM ops_usage n
 WHERE n.provider=u.provider AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period)
 AND n.at_ms>u.at_ms AND n.at_ms<=?) AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,nowMs,nowMs,period(nowMs));}
function spendSql(nowMs){return sql("SELECT * FROM ops_optional_spend WHERE at_ms<=? AND (status='reserved' OR COALESCE(settled_ms,at_ms)>=?) LIMIT 101",nowMs,Date.parse(period(nowMs,true)+'-01T00:00:00Z'));}
export function createAtomicOperationsRepository(driver,{crypto,ids,telemetry={record(){}}}){
 const {read,replay,execute}=createAtomicReceipts(driver,{crypto,ids,telemetry});
 const hashOrdered=value=>crypto.sha256(utf8(orderedJson(value)));
 async function validate(command,kind){
  const {principal,input,requestKey,nowMs,expectedRevisions}=command;
  if(principal?.kind!=='operator'||command.operationKind!==kind)throw new TypeError('Invalid operations principal or kind.');
  name(principal.id,'operator');nat(nowMs,'now');
  requireValue(input && canonicalJson(Object.keys(input).sort())===canonicalJson([...fields[kind]].sort()),'Invalid operations input fields.');
  requireValue(typeof requestKey==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey),'Invalid request key.');
  requireValue(expectedRevisions&&Object.entries(expectedRevisions).every(([key,value])=>['earn','source','control'].includes(key)&&typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)),'Invalid expected revisions.');
  if(command.businessIdentity!==business(kind,input,requestKey,principal.id)||command.requestDigest!==await crypto.sha256(requestBytes(command)))throw new TypeError('Invalid operations digest.');
  return replay(command);
 }
 async function context(command,statements=[]){
  const [versionRows,grants,...rows]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='operations'",command.principal.id),...statements]);
  const version=revisions(versionRows);
  if(!grants[0]?.enabled)return {outcome:conflict('operator_scope_required')};
  if(Object.entries(command.expectedRevisions).some(([key,value])=>version[key]!==value))return {outcome:conflict('revision_conflict')};
  return {version,rows};
 }
 async function commit(command,ctx,{input,result,resultRef,child}){
  return execute(command,{businessKey:command.businessIdentity,input,result,resultRef,version:ctx.version,child,
   authoritySql:"EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='operations' AND enabled=1)",authorityValues:[command.principal.id]});
 }
 async function audit(head,event){
  const seq=(head?.seq??0)+1,previousHash=head?.event_hash??null,payload=orderedJson(event.payload);
  requireValue(utf8(payload).length<=16*1024,'Audit payload too large.');
  const eventHash=await hashOrdered(['10x-local-config-audit-v1',seq,previousHash,event.category,event.entity,event.changeKey,event.atMs,event.actor,event.evidenceRef,event.payload]);
  return {seq,previousHash,eventHash,payload};
 }
 const auditSql=(a,e,gate,values)=>sql(`INSERT INTO ops_config_audit SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,
  a.seq,a.previousHash,a.eventHash,e.category,e.entity,e.changeKey,e.atMs,e.actor,e.evidenceRef,a.payload,...values);
 const repository={
  async changeScope(command){
   const prior=await validate(command,OPERATIONS.changeScope);if(prior)return prior;
   const {input:i,principal,nowMs,requestKey}=command;scope(i.scope);requireValue(typeof i.paused==='boolean','Specify pause or resume.');
   for(const key of ['reason','evidenceRef'])name(i[key],key);
   requireValue(i.previousRevision===null||typeof i.previousRevision==='string','Invalid prior scope revision.');
   const ctx=await context(command,[sql('SELECT * FROM ops_scope_log WHERE scope=? ORDER BY at_ms DESC LIMIT 1',i.scope),
    sql('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1'),sql('SELECT request_key FROM ops_scope_log WHERE request_key=?',requestKey)]);
   if(ctx.outcome)return ctx.outcome;const [states,heads,keys]=ctx.rows;
   if(keys.length)return conflict('idempotency_conflict');
   if((states[0]?.revision??null)!==i.previousRevision||(states[0]&&nowMs<=states[0].at_ms))return conflict('stale_scope');
   const revision=await hashOrdered([i.scope,i.paused,i.previousRevision,nowMs,principal.id,i.reason,i.evidenceRef,requestKey]);
   const event={category:'scope-change',entity:i.scope,changeKey:requestKey,atMs:nowMs,actor:principal.id,evidenceRef:i.evidenceRef,
    payload:{paused:i.paused,reason:i.reason,revision,previousRevision:i.previousRevision}};
   const a=await audit(heads[0],event);
   return commit(command,ctx,{input:{...i,actor:principal.id,revision,audit:a},result:{scope:i.scope,paused:i.paused,revision},resultRef:revision,
    child:(gate,values)=>[sql(`INSERT INTO ops_scope_log SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate}`,
      revision,i.scope,Number(i.paused),i.previousRevision,nowMs,principal.id,i.reason,i.evidenceRef,requestKey,...values),auditSql(a,event,gate,values)]});
  },
  async configureWorkload(command){
   const prior=await validate(command,OPERATIONS.configureWorkload);if(prior)return prior;
   const {input:i,principal,nowMs}=command;nat(i.effectiveEpoch,'epoch');name(i.reason,'reason');
   requireValue(i.effectiveEpoch>=Math.floor(nowMs/86400000),'Capacity changes must be current or prospective.');
   requireValue(Number.isInteger(i.staffedMinutes)&&i.staffedMinutes>=0&&i.staffedMinutes<=1440,'Invalid staffed minutes.');
   requireValue(Number.isInteger(i.secondsPerReview)&&i.secondsPerReview>=1&&i.secondsPerReview<=3600,'Invalid review estimate.');
   requireValue(Number.isInteger(i.admissionLimit)&&i.admissionLimit>=0&&i.admissionLimit<=100,'Invalid pilot capacity.');
   const ctx=await context(command,[sql('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1',i.effectiveEpoch),
    sql('SELECT 1 FROM earn_workload_policies WHERE effective_epoch=? AND recorded_ms=?',i.effectiveEpoch,nowMs),
    sql('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')]);
   if(ctx.outcome)return ctx.outcome;const [boards,duplicate,heads]=ctx.rows;
   if(boards.length)return conflict('board_closed');if(duplicate.length)return conflict('workload_conflict');
   const revision=await hashOrdered([i.effectiveEpoch,nowMs,i.staffedMinutes,i.secondsPerReview,i.admissionLimit,principal.id,i.reason]);
   const event={category:'staffing',entity:'Earn',changeKey:revision,atMs:nowMs,actor:principal.id,evidenceRef:i.reason,
    payload:{effectiveEpoch:i.effectiveEpoch,staffedMinutes:i.staffedMinutes,secondsPerReview:i.secondsPerReview,admissionLimit:i.admissionLimit,revision}};
   const a=await audit(heads[0],event);
   return commit(command,ctx,{input:{...i,actor:principal.id,revision,audit:a},result:{revision,effectiveEpoch:i.effectiveEpoch,limit:Math.min(i.admissionLimit,Math.floor(i.staffedMinutes*60/i.secondsPerReview))},resultRef:revision,
    child:(gate,values)=>[sql(`INSERT INTO earn_workload_policies SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
      revision,i.effectiveEpoch,nowMs,i.staffedMinutes,i.secondsPerReview,i.admissionLimit,principal.id,i.reason,...values),auditSql(a,event,gate,values)]});
  },
  async reserveOptionalCost(command){
   const prior=await validate(command,OPERATIONS.reserveOptionalCost);if(prior)return prior;
   const {input:i,principal,nowMs,requestKey}=command;scope(i.scope);name(i.quoteRef,'quote');const upper=amount(i.upperUsdMicros,'spend ceiling');
   const ctx=await context(command,[sql('SELECT 1 FROM ops_optional_spend WHERE request_key=?',requestKey),
    sql('SELECT * FROM ops_scope_log WHERE scope=? AND at_ms<=? ORDER BY at_ms DESC LIMIT 1',i.scope,nowMs),usageSql(nowMs),spendSql(nowMs)]);
   if(ctx.outcome)return ctx.outcome;const [old,states,usage,spend]=ctx.rows;if(old.length)return conflict('idempotency_conflict');
   const pressure=pressureFromRows(usage,spend,nowMs),decision=decisionFromRows(i.scope,states[0],pressure);
   if(!decision.allowed)return pending(decision.reason);
   if(BigInt(pressure.recurring.totalUsdMicros)+upper>BigInt(pressure.recurring.limitUsdMicros))return pending('monthly-ceiling');
   return commit(command,ctx,{input:{...i,actor:principal.id,period:pressure.period},result:{status:'reserved',requestKey},resultRef:requestKey,
    child:(gate,values)=>sql(`INSERT INTO ops_optional_spend SELECT ?,?,?,?,?,?,?,'reserved',NULL,NULL,NULL WHERE ${gate}`,
     requestKey,i.scope,pressure.period,nowMs,i.upperUsdMicros,principal.id,i.quoteRef,...values)});
  },
  async settleOptionalCost(command){
   const prior=await validate(command,OPERATIONS.settleOptionalCost);if(prior)return prior;
   const {input:i,principal,nowMs}=command;name(i.reservationKey,'reservation');name(i.evidenceRef,'evidence');const actual=amount(i.actualUsdMicros,'actual spend');
   const ctx=await context(command,[sql('SELECT * FROM ops_optional_spend WHERE request_key=?',i.reservationKey)]);
   if(ctx.outcome)return ctx.outcome;const row=ctx.rows[0][0];
   if(!row)return conflict('unknown_reservation');if(row.status==='settled')return conflict('cost_sealed');if(nowMs<row.at_ms)return conflict('invalid_settlement_time');
   return commit(command,ctx,{input:{...i,actor:principal.id},result:{status:'settled',requestKey:i.reservationKey,overrun:actual>BigInt(row.limit_usd_micros)},resultRef:i.reservationKey,
    child:(gate,values)=>sql(`UPDATE ops_optional_spend SET status='settled',actual_usd_micros=?,settlement_ref=?,settled_ms=? WHERE request_key=? AND status='reserved' AND ${gate}`,
      i.actualUsdMicros,i.evidenceRef,nowMs,i.reservationKey,...values)});
  },
  /** Pre-attempt quota admission only: pending forbids an external call. The
   * accepted attempt consumes units even if its later provider call fails.
   * B03 must persist dispatch/outcome checkpoints; replay alone never permits
   * redispatch. Same-ms pending can retry later because no call has occurred.
   * This local repository never contacts a provider or enables spending. */
  async meterProviderAttempt(command){
   const prior=await validate(command,OPERATIONS.meterProviderAttempt);if(prior)return prior;
   const {input:i,principal,nowMs}=command;for(const field of ['attemptId','provider','evidenceRef'])name(i[field],field);
   const units=amount(i.units,'provider units'),quota=amount(i.quota,'quota');requireValue(units>0n&&quota>0n,'Positive attempt units and quota required.');
   const day=period(nowMs),ctx=await context(command,[sql('SELECT 1 FROM app_provider_attempts WHERE attempt_id=?',i.attemptId),
    sql("SELECT * FROM ops_usage WHERE provider=? AND metric='daily-provider-units' AND period=? ORDER BY at_ms DESC LIMIT 1",i.provider,day)]);
   if(ctx.outcome)return ctx.outcome;const [old,usage]=ctx.rows;if(old.length)return conflict('attempt_sealed');
   if(usage[0]&&nowMs<=usage[0].at_ms)return pending('attempt-observation-time');
   const measured=String(BigInt(usage[0]?.measured??'0')+units);
   if(BigInt(measured)>quota)return pending('provider-quota');
   const usageReceipt=await hashOrdered([i.provider,'daily-provider-units',measured,i.quota,nowMs,i.evidenceRef]);
   return commit(command,ctx,{input:{...i,actor:principal.id,period:day,measured,usageReceipt},result:{phase:'pre-attempt',attemptId:i.attemptId,receipt:usageReceipt,period:day,measured,quota:i.quota},resultRef:i.attemptId,
    child:(gate,values)=>[sql(`INSERT INTO ops_usage SELECT ?,?,'daily-provider-units',?,?,?,?,? WHERE ${gate}`,
      usageReceipt,i.provider,day,nowMs,measured,i.quota,i.evidenceRef,...values),
      sql(`INSERT INTO app_provider_attempts SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,
      i.attemptId,i.provider,i.units,i.quota,nowMs,principal.id,i.evidenceRef,usageReceipt,...values)]});
  },
  async costPressure(nowMs){nat(nowMs,'now');const [usage,spend]=await read([usageSql(nowMs),spendSql(nowMs)]);return pressureFromRows(usage,spend,nowMs);},
  async actionDecision(selected,nowMs){
   nat(nowMs,'now');if(protectedScopes.includes(selected))return {scope:selected,allowed:true,reason:'protected-recovery'};scope(selected);
   const [states,usage,spend]=await read([sql('SELECT * FROM ops_scope_log WHERE scope=? AND at_ms<=? ORDER BY at_ms DESC LIMIT 1',selected,nowMs),usageSql(nowMs),spendSql(nowMs)]);
   return decisionFromRows(selected,states[0],pressureFromRows(usage,spend,nowMs));
  },
  async capacityAt(epoch,nowMs){
   nat(epoch,'epoch');nat(nowMs,'now');const [policies,counts]=await read([
    sql('SELECT * FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=? ORDER BY effective_epoch DESC,recorded_ms DESC LIMIT 1',epoch,nowMs),
    sql('SELECT admitted FROM earn_admission_counts WHERE epoch=?',epoch)]);
   const p=policies[0],limit=p?Math.min(p.admission_limit,Math.floor(p.staffed_minutes*60/p.seconds_per_review)):0,admitted=counts[0]?.admitted??0;
   return {epoch,limit,admitted,remaining:Math.max(0,limit-admitted),accepting:Math.floor(nowMs/86400000)===epoch&&limit>admitted,policy:p?.revision??null};
  },
  getBookmark(){return driver.getBookmark();},
 };
 // A revision changed during preflight: recompute once, preserving explicit
 // caller revisions. A stable cloned identity survives every await/retry.
 for(const method of Object.keys(OPERATIONS)){
  const run=repository[method];
  repository[method]=async command=>{
   const snapshot=JSON.parse(canonicalJson(command));
   const result=await run(snapshot);
   if(result.kind!=='conflict'||result.code!=='revision_conflict'||Object.keys(snapshot.expectedRevisions).length)return result;
   const retried=await run(snapshot);
   return retried.kind==='conflict'&&retried.code==='revision_conflict'?pending('operating-contention'):retried;
  };
 }
 return Object.freeze(repository);
}
