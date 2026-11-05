import { LEVEL_QUOTAS, seasonExpiry } from '../domain/collections/policy.mjs';
const iso=ms=>new Date(ms).toISOString();
/** Read-only fixture eligibility. A missing complete free-stage cut is unknown. */
export function stageEligibility(stage,wallet) {
  const cutoffAt=stage.type==='free'?iso(stage.opensAt):null;
  if(!wallet)return {status:'unknown',reason:'wallet-not-connected',cutoffAt};
  if(stage.type==='free' && stage.wallets===null)return {status:'unknown',reason:'opening-snapshot-pending',cutoffAt};
  const eligible=stage.type==='public'||Boolean(stage.wallets?.includes(wallet));
  return {status:eligible?'eligible':'ineligible',reason:stage.type==='public'?'public-stage':eligible?'included-in-published-list':'absent-from-published-list',cutoffAt};
}
/** Current admission availability is separate from immutable list membership. */
export function stageReservationStatus(stage,wallet,{now,status,used,openingHold,snapshotId=null}){
  const membership=stageEligibility(stage,wallet),remaining=wallet?Math.max(0,stage.walletLimit-used):null;
  let reason='eligible',availability='available';
  if(!wallet){reason='not-signed-in';availability='unknown';}
  else if(openingHold){reason='opening-hold';availability='unavailable';}
  else if(status==='scheduled'){reason='stage-scheduled';availability='unavailable';}
  else if(status==='closed'){reason='stage-closed';availability='unavailable';}
  else if(status==='sold-out'){reason='sold-out';availability='unavailable';}
  else if(membership.status==='unknown'){reason='snapshot-pending';availability='unknown';}
  else if(membership.status==='ineligible'){reason='not-on-list';availability='unavailable';}
  else if(remaining===0){reason='wallet-limit';availability='unavailable';}
  else if(stage.type==='founder'){reason='operator-only';availability='unavailable';}
  return {status:availability,reason,snapshotId,used:wallet?used:null,remaining,stageStatus:status,
    asOf:iso(now),source:'local-fixture',executable:false};
}
export function expirySchedule(start,now) {
  return LEVEL_QUOTAS.map((_,i)=>{const expiry=seasonExpiry(start,i+1);
    return {level:i+1,expiresAt:iso(expiry),remainingMs:Math.max(0,expiry-now)};});
}
/** Never read concealed asset JSON: only approved revealed metadata contributes. */
export function inventoryDisclosure(db,id,counts,start,now) {
  const revealed=db.prepare('SELECT asset FROM collect_assets WHERE inventory_id=? AND reveal_ms<=?').all(id,now);
  const concealed=db.prepare('SELECT COUNT(*) AS n FROM collect_assets WHERE inventory_id=? AND (reveal_ms IS NULL OR reveal_ms>?)').get(id,now).n;
  const levels=Array(10).fill(0);
  for(const row of revealed)levels[JSON.parse(row.asset).level-1]++;
  return {asOf:iso(now),counts:{...counts,paidStageAllocations:counts.paid,freeStageAllocations:counts.free,founderStageAllocations:counts.founder},
    revealedLevelCounts:levels,concealedCount:concealed,seasonExpiries:start===null?null:expirySchedule(start,now)};
}
