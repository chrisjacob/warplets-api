import {CAMPAIGN_SECONDS} from '../domain/economics/launch.mjs';
import {simulateStakeFarm} from '../domain/economics/stake.mjs';
const sec=ms=>BigInt(Math.floor(ms/1000));
const iso=ms=>new Date(ms).toISOString();
export const decimal=value=>{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value))throw Error('Expected a decimal base-unit string.');
 return BigInt(value);
};
export function projectTrace(row,ms,events) {
 return simulateStakeFarm({activatedAt:sec(row.activation_ms),budget:BigInt(row.funded_units),treasuryFeeBps:BigInt(row.treasury_fee_bps),
  through:sec(ms),events:events.map(e=>({id:e.id,kind:e.kind,wallet:e.wallet,at:sec(e.at_ms),amount:e.amount===null?undefined:decimal(e.amount)}))});
}
export function describeFarm(row,ms,wallet,events){
 const common={marketId:row.market_id,fundedUnits:row.funded_units,treasuryFeeBps:row.treasury_fee_bps,
  activationTime:iso(row.activation_ms),emissionEnd:iso(row.activation_ms+Number(CAMPAIGN_SECONDS)*1000),
  asOf:iso(ms),source:'local-fixture',executable:false};
 if(ms<row.activation_ms)return {...common,status:'scheduled'};
 const state=projectTrace(row,ms,events);
 if(wallet){
  const p=state.balances.find(p=>p.wallet===wallet);
  return {...common,principalUnits:String(p?.principal??0n),earnedGrossUnits:String(p?.earnedGross??0n),
   claimableGrossUnits:String(p?.claimableGross??0n),harvestedGrossUnits:String(p?.harvestedGross??0n)};
 }
 return {...common,status:sec(ms)>=sec(row.activation_ms)+CAMPAIGN_SECONDS?'ended':'active',
  totalStakedUnits:String(state.totalPrincipal),earnedGrossUnits:String(state.earnedGross),
  unusedRecoverableUnits:String(state.recoverableIdle),roundingReserveUnits:String(state.roundingReserve)};
}
