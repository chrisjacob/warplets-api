import { transaction } from '../storage/database.mjs';
import { assessRecurring } from '../costs/budget.mjs';
import { conflict, decimal, digest, name, nat, requireValue } from '../earn/checks.mjs';
import { appendAudit } from './audit.mjs';

export const controlledScopes=Object.freeze(['launch-preparation','earn-admission','collection-mint','collection-progression',
  'optional-refresh','optional-images','optional-notifications']);
export const protectedScopes=Object.freeze(['principal-withdrawal','stake-harvest','vault-claim','earn-claim','reconciliation','operation-recovery']);
const throttleAtWarning=new Set(['optional-refresh','optional-images']);
function checkScope(scope) {
  requireValue(controlledScopes.includes(scope),'Choose a controllable application scope. Claims, principal and recovery are protected.');
}
function period(atMs,monthly) {nat(atMs,'time');return new Date(atMs).toISOString().slice(0,monthly?7:10);}
function latestScope(db,scope,now) {
  return db.prepare('SELECT * FROM ops_scope_log WHERE scope=? AND at_ms<=? ORDER BY at_ms DESC LIMIT 1').get(scope,now);
}
export function changeScope(db,{scope,paused,previousRevision=null,atMs,actor,reason,evidenceRef,requestKey}) {
  checkScope(scope);requireValue(typeof paused==='boolean','Specify pause or resume.');
  nat(atMs,'time');name(actor,'operator');name(reason,'reason');name(evidenceRef,'evidence');name(requestKey,'operation key');
  const revision=digest([scope,paused,previousRevision,atMs,actor,reason,evidenceRef,requestKey]);
  return transaction(db,()=>{
    const replay=db.prepare('SELECT revision FROM ops_scope_log WHERE request_key=?').get(requestKey);
    if (replay) {
      if (replay.revision!==revision) conflict('key_conflict','Scope change key was used for different instructions.');
      return {scope,paused,revision};
    }
    const latest=db.prepare('SELECT revision,at_ms FROM ops_scope_log WHERE scope=? ORDER BY at_ms DESC LIMIT 1').get(scope);
    if ((latest?.revision??null)!==previousRevision || (latest && atMs<=latest.at_ms)) conflict('stale_scope','Refresh scope revision before changing policy.');
    db.prepare('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)').run(revision,scope,Number(paused),previousRevision,atMs,actor,reason,evidenceRef,requestKey);
    appendAudit(db,{category:'scope-change',entity:scope,changeKey:requestKey,atMs,actor,evidenceRef,payload:{paused,reason,revision,previousRevision}});
    return {scope,paused,revision};
  });
}

// Recurring run rates carry forward until a sourced change or cancellation.
// Daily unit counters reset each UTC day. Exclude charges already reserved here.
export function recordUsage(db,{provider,metric,measured,quota=null,atMs,evidenceRef}) {
  name(provider,'provider');name(evidenceRef,'source');nat(atMs,'observed time');
  requireValue(['new-monthly-usd','daily-provider-units'].includes(metric),'Unknown usage metric.');
  const value=decimal(measured,'measured units');
  if(metric==='daily-provider-units')requireValue(decimal(quota,'provider quota')>0n,'Positive quota needed.');
  else requireValue(quota===null,'Combined recurring ceiling comes from project policy.');
  const key=period(atMs,metric==='new-monthly-usd');
  const receipt=digest([provider,metric,measured,quota,atMs,evidenceRef]);
  return transaction(db,()=>{
    const existing=db.prepare('SELECT 1 FROM ops_usage WHERE receipt=?').get(receipt);
    if (existing) return {receipt,period:key};
    const prev=db.prepare('SELECT * FROM ops_usage WHERE provider=? AND metric=? AND period=? ORDER BY at_ms DESC LIMIT 1').get(provider,metric,key);
    if(prev && (atMs<=prev.at_ms || (metric==='daily-provider-units'&&value<BigInt(prev.measured)))) conflict('usage_conflict','Usage observations must advance within the reporting period.');
    db.prepare('INSERT INTO ops_usage VALUES(?,?,?,?,?,?,?,?)').run(receipt,provider,metric,key,atMs,measured,quota,evidenceRef);
    return {receipt,period:key};
  });
}
function latestUsage(db,key,atMs) {
  return db.prepare(`SELECT * FROM ops_usage u WHERE u.period=? AND u.at_ms<=?
    AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.period=u.period AND n.metric=u.metric AND n.provider=u.provider
    AND n.at_ms>u.at_ms AND n.at_ms<=?) ORDER BY provider`).all(key,atMs,atMs);
}
export function costPressure(db,now) {
  const month=period(now,true),day=period(now,false);
  const monthly=db.prepare(`SELECT * FROM ops_usage u WHERE u.metric='new-monthly-usd' AND u.at_ms<=?
    AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.metric=u.metric AND n.provider=u.provider AND n.at_ms>u.at_ms AND n.at_ms<=?)`)
    .all(now,now),quotas=latestUsage(db,day,now);
  let total=monthly.reduce((s,r)=>s+BigInt(r.measured),0n);
  const monthStart=Date.parse(month+'-01T00:00:00.000Z');
  const reservations=db.prepare(`SELECT status,limit_usd_micros,actual_usd_micros,COALESCE(settled_ms,at_ms) AS settled_at
    FROM ops_optional_spend WHERE at_ms<=? AND
    (status='reserved' OR COALESCE(settled_ms,at_ms)>? OR COALESCE(settled_ms,at_ms)>=?)`).all(now,now,monthStart);
  for (const row of reservations) total+=BigInt(row.status==='reserved'||row.settled_at>now?row.limit_usd_micros:row.actual_usd_micros);
  const recurring=assessRecurring(total);
  const providerLevels=quotas.map(r=>({provider:r.provider,status:BigInt(r.measured)>=BigInt(r.quota)?'limit':
    BigInt(r.measured)*5n>=BigInt(r.quota)*4n?'warning':'normal'}));
  const limited=['at-limit','over-limit'].includes(recurring.status)||providerLevels.some(r=>r.status==='limit');
  const warning=recurring.status==='warning'||providerLevels.some(r=>r.status==='warning');
  return {level:limited?'limit':warning?'warning':'normal',recurring,providers:providerLevels,
    measuredProviderCount:monthly.length+quotas.length,period:month};
}
export function actionDecision(db,scope,now) {
  if(protectedScopes.includes(scope))return {scope,allowed:true,reason:'protected-recovery'};
  checkScope(scope);nat(now,'now');
  const state=latestScope(db,scope,now);
  if(state?.paused)return {scope,allowed:false,reason:'operator-pause',revision:state.revision};
  const {level}=costPressure(db,now);
  if(level==='limit'||(level==='warning'&&throttleAtWarning.has(scope))) return {scope,allowed:false,reason:'budget-'+level};
  return {scope,allowed:true,reason:level==='warning'?'budget-warning':'available',revision:state?.revision??null};
}
export function reserveOptionalCost(db,{scope,now,upperUsdMicros,actor,quoteRef,requestKey}) {
  checkScope(scope);name(actor,'operator');name(quoteRef,'quote');name(requestKey,'key');
  const upper=decimal(upperUsdMicros,'spend ceiling');nat(now,'now');
  return transaction(db,()=>{
    const old=db.prepare('SELECT * FROM ops_optional_spend WHERE request_key=?').get(requestKey);
    if(old) {
      if(old.scope!==scope || old.limit_usd_micros!==upperUsdMicros || old.actor!==actor || old.quote_ref!==quoteRef) conflict('key_conflict','Different optional cost for this key.');
      return {status:old.status,requestKey,replay:true};
    }
    const decision=actionDecision(db,scope,now);
    if(!decision.allowed) return {status:'held',reason:decision.reason};
    const pressure=costPressure(db,now);
    if(BigInt(pressure.recurring.totalUsdMicros)+upper>BigInt(pressure.recurring.limitUsdMicros))return {status:'held',reason:'monthly-ceiling'};
    db.prepare('INSERT INTO ops_optional_spend VALUES(?,?,?,?,?,?,?,\'reserved\',NULL,NULL,NULL)').run(requestKey,scope,pressure.period,now,upperUsdMicros,actor,quoteRef);
    return {status:'reserved',requestKey,replay:false};
  });
}
export function settleOptionalCost(db,{requestKey,actualUsdMicros,evidenceRef,now=Date.now()}) {
  name(requestKey,'key');name(evidenceRef,'receipt');nat(now,'settlement time');const actual=decimal(actualUsdMicros,'actual charge');
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM ops_optional_spend WHERE request_key=?').get(requestKey);
    requireValue(row,'Unknown reservation.');
    requireValue(now>=row.at_ms,'Settlement cannot precede its reservation.');
    if(row.status==='settled') {
      if(row.actual_usd_micros!==actualUsdMicros||row.settlement_ref!==evidenceRef) conflict('cost_sealed','Cost already reconciled with another receipt.');
      return {status:'settled',requestKey,replay:true,overrun:actual>BigInt(row.limit_usd_micros)};
    }
    // Record an actual overrun even if a provider exceeded the authorized quote.
    db.prepare("UPDATE ops_optional_spend SET status='settled',actual_usd_micros=?,settlement_ref=?,settled_ms=? WHERE request_key=?").run(actualUsdMicros,evidenceRef,now,requestKey);
    return {status:'settled',requestKey,replay:false,overrun:actual>BigInt(row.limit_usd_micros)};
  });
}
