import { assessRecurring } from '../costs/budget.mjs';
export const controlledScopes=Object.freeze(['launch-preparation','earn-admission','collection-mint','collection-progression',
 'optional-refresh','optional-images','optional-notifications']);
export const protectedScopes=Object.freeze(['principal-withdrawal','stake-harvest','vault-claim','earn-claim','reconciliation','operation-recovery']);
export const period=(atMs,monthly=false)=>new Date(atMs).toISOString().slice(0,monthly?7:10);
export function pressureFromRows(usage,spend,nowMs){
 if(usage.length>100 || spend.length>100)return {status:'pending',reason:'operating-input-bound'};
 const month=period(nowMs,true),day=period(nowMs),start=Date.parse(month+'-01T00:00:00Z');
 const monthly=usage.filter(row=>row.metric==='new-monthly-usd'),daily=usage.filter(row=>row.metric==='daily-provider-units'&&row.period===day);
 let total=monthly.reduce((sum,row)=>sum+BigInt(row.measured),0n);
 for(const row of spend){
  const at=row.settled_ms??row.at_ms;
  if(row.status==='reserved'||at>nowMs)total+=BigInt(row.limit_usd_micros);
  else if(at>=start)total+=BigInt(row.actual_usd_micros);
 }
 const recurring=assessRecurring(total),providers=daily.map(row=>({provider:row.provider,
  status:BigInt(row.measured)>=BigInt(row.quota)?'limit':BigInt(row.measured)*5n>=BigInt(row.quota)*4n?'warning':'normal'}));
 const limited=['at-limit','over-limit'].includes(recurring.status)||providers.some(row=>row.status==='limit');
 const warning=recurring.status==='warning'||providers.some(row=>row.status==='warning');
 return {status:'ready',level:limited?'limit':warning?'warning':'normal',recurring,providers,
  measuredProviderCount:monthly.length+daily.length,period:month};
}
export function decisionFromRows(scope,state,pressure){
 if(protectedScopes.includes(scope))return {scope,allowed:true,reason:'protected-recovery'};
 if(!controlledScopes.includes(scope))throw new TypeError('Unknown controllable scope.');
 if(state?.paused)return {scope,allowed:false,reason:'operator-pause',revision:state.revision};
 if(pressure.status==='pending')return {scope,allowed:false,reason:pressure.reason};
 if(pressure.level==='limit'||(pressure.level==='warning'&&['optional-refresh','optional-images'].includes(scope)))
  return {scope,allowed:false,reason:'budget-'+pressure.level};
 return {scope,allowed:true,reason:pressure.level==='warning'?'budget-warning':'available',revision:state?.revision??null};
}
