import {DAY_MS,applyPurchaseActivity,enrollPosition,epochAt,snapshotPurchasePosition} from '../domain/earn/index.mjs';
import {canonicalJson} from '../security/canonical.mjs';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
const time=n=>integer(n)&&n<=8640000000000000;
const identifier=s=>typeof s==='string'&&s.length>0&&s.length<=256&&s.trim()===s;
const decimal=s=>typeof s==='string'&&/^(0|[1-9][0-9]{0,159})$/.test(s);
const units=s=>decimal(s)&&BigInt(s)<=(1n<<64n)-1n;
const cutoff=epoch=>(epoch+1)*DAY_MS-1;
function pending(dependencies){
 const unique=new Map(dependencies.map(d=>[canonicalJson([d.epoch,d.reason]),d]));
 return {status:'pending',dependencies:[...unique.values()].sort((a,b)=>a.epoch-b.epoch||(a.reason<b.reason?-1:a.reason>b.reason?1:0))};
}
const held=(epoch,reason)=>pending([{epoch,reason}]);
function normalizeEvent(event,wallet,tokenId){
 if(!event||event.wallet!==wallet||event.tokenId!==tokenId||event.confirmed!==true||!identifier(event.signature)||!integer(event.instructionIndex)||
  !integer(event.sequence)||event.sequence<1||!time(event.atMs))return {reason:'position-history-identity'};
 const normalized={type:event.type,signature:event.signature,instructionIndex:event.instructionIndex,wallet,tokenId,sequence:event.sequence,atMs:event.atMs,confirmed:true};
 if(event.type==='verified-buy-and-stake'){
  if(!integer(event.swapIndex)||event.swapIndex>=event.instructionIndex||!units(event.netBoughtUnits)||!units(event.depositedUnits)||
   BigInt(event.netBoughtUnits)===0n||BigInt(event.depositedUnits)===0n)return {reason:'position-history-purchase'};
  Object.assign(normalized,{swapIndex:event.swapIndex,netBoughtUnits:event.netBoughtUnits,depositedUnits:event.depositedUnits});
 }else if(event.type==='withdrawal'){
  if(!units(event.withdrawnUnits)||!units(event.remainingStakeUnits))return {reason:'position-history-withdrawal'};
  Object.assign(normalized,{withdrawnUnits:event.withdrawnUnits,remainingStakeUnits:event.remainingStakeUnits});
 }else if(!['deposit','reward','restake','exit','position-transfer'].includes(event.type))return {reason:'position-history-kind'};
 // Input must be the v2 economic normalization, not an arbitrary farm payload.
 if(canonicalJson(normalized)!==canonicalJson(event))return {reason:'position-history-fields'};
 return {event:normalized};
}
// No database, clock or I/O. The coordinator must separately prove full history
// coverage and the exact immutable source/read identities for these inputs.
export function verifyPositionChain(value){
 let input;try{input=JSON.parse(canonicalJson(value));}catch{return held(0,'position-chain-input');}
 if(!input||!identifier(input.wallet)||!identifier(input.tokenId)||!time(input.enrolledMs)||!time(input.activationMs)||!integer(input.throughEpoch)||
  !time(cutoff(input.throughEpoch)))return held(integer(input?.throughEpoch)?input.throughEpoch:0,'position-chain-input');
 const {wallet,tokenId,enrolledMs,activationMs,throughEpoch}=input,startEpoch=epochAt(enrolledMs),through=cutoff(throughEpoch);
 if(enrolledMs<activationMs||enrolledMs>=activationMs+10*DAY_MS||throughEpoch<startEpoch)return held(startEpoch,'position-enrollment-boundary');
 if(throughEpoch-startEpoch>10||!Array.isArray(input.events)||input.events.length>1000||!Array.isArray(input.checkpoints)||input.checkpoints.length>11||
  !Array.isArray(input.valuations)||input.valuations.length>11)return held(startEpoch,'position-chain-bound');
 const events=[],seenInstructions=new Set(),purchases=new Set();let previousTime=enrolledMs;
 for(const raw of input.events){
  const eventEpoch=time(raw?.atMs)?epochAt(raw.atMs):startEpoch,normalized=normalizeEvent(raw,wallet,tokenId);
  if(normalized.reason)return held(eventEpoch,normalized.reason);const event=normalized.event;
  if(event.sequence!==events.length+1)return held(eventEpoch,'position-history-sequence');
  if(event.atMs<previousTime||event.atMs>through)return held(eventEpoch,'position-history-time');
  const key=canonicalJson([event.signature,event.instructionIndex]);
  if(seenInstructions.has(key))return held(eventEpoch,'position-history-duplicate-instruction');seenInstructions.add(key);
  if(event.type==='verified-buy-and-stake'){
   if(purchases.has(event.signature))return held(eventEpoch,'position-history-duplicate-purchase');purchases.add(event.signature);
  }
  events.push(event);previousTime=event.atMs;
 }
 const checkpoints=new Map(),valuations=new Map(),dependencies=[];
 for(const [rows,map,label] of [[input.checkpoints,checkpoints,'checkpoint'],[input.valuations,valuations,'valuation']]){
  for(const row of rows){
   if(!integer(row?.epoch)||row.epoch<startEpoch||row.epoch>throughEpoch)return held(startEpoch,'position-'+label+'-epoch');
   if(map.has(row.epoch))return held(row.epoch,'position-'+label+'-duplicate');map.set(row.epoch,row);
  }
 }
 for(let epoch=startEpoch;epoch<=throughEpoch;epoch++){
  const checkpoint=checkpoints.get(epoch),valuation=valuations.get(epoch),at=cutoff(epoch);
  if(!checkpoint)dependencies.push({epoch,reason:'position-checkpoint-missing'});
  else if(!integer(checkpoint.sequence)||!decimal(checkpoint.credited)||!units(checkpoint.stake)||!decimal(checkpoint.numerator)||!decimal(checkpoint.denominator)||
   !Array.isArray(checkpoint.flags)||checkpoint.flags.some(f=>!integer(f))||!integer(checkpoint.tokenDays)||
   typeof checkpoint.sourceRef!=='string'||!checkpoint.sourceRef.length||checkpoint.sourceRef.length>2048)dependencies.push({epoch,reason:'position-checkpoint-invalid'});
  if(!valuation)dependencies.push({epoch,reason:'position-valuation-missing'});
  else if(valuation.status!=='verified')dependencies.push({epoch,reason:'position-valuation-pending'});
  else if(valuation.asOfMs!==at)dependencies.push({epoch,reason:'position-valuation-cutoff'});
  else if(!time(valuation.expiresMs)||valuation.expiresMs<at)dependencies.push({epoch,reason:'position-valuation-expired'});
  else if(!units(valuation.stakedUnits)||!decimal(valuation.priceNumerator)||!decimal(valuation.priceDenominator)||
   BigInt(valuation.priceNumerator)===0n||BigInt(valuation.priceDenominator)===0n||
   valuation.microUsd!==undefined&&(!decimal(valuation.microUsd)||BigInt(valuation.microUsd)!==BigInt(valuation.stakedUnits)*BigInt(valuation.priceNumerator)/BigInt(valuation.priceDenominator)))
   dependencies.push({epoch,reason:'position-valuation-amount'});
  else if(valuation.receipt!==undefined&&!identifier(valuation.receipt)||valuation.readId!==undefined&&!identifier(valuation.readId))dependencies.push({epoch,reason:'position-valuation-identity'});
  else if(checkpoint&&valuation.receipt!==undefined&&typeof checkpoint.sourceRef==='string'&&!checkpoint.sourceRef.endsWith(' / '+valuation.receipt))dependencies.push({epoch,reason:'position-checkpoint-price-reference'});
 }
 if(dependencies.length)return pending(dependencies);
 let position=enrollPosition(wallet,tokenId),eventIndex=0;const chain=[];
 for(let epoch=startEpoch;epoch<=throughEpoch;epoch++){
  while(eventIndex<events.length&&events[eventIndex].atMs<=cutoff(epoch)){
   const event={...events[eventIndex++]};
   for(const field of ['netBoughtUnits','depositedUnits','withdrawnUnits','remainingStakeUnits'])if(Object.hasOwn(event,field))event[field]=BigInt(event[field]);
   position=applyPurchaseActivity(position,event);
  }
  const v=valuations.get(epoch),stored=checkpoints.get(epoch);
  const result=snapshotPurchasePosition(position,{epoch,active:activationMs<=cutoff(epoch)&&cutoff(epoch)<activationMs+10*DAY_MS,
   reconciledSequence:position.sequence,stakedUnits:BigInt(v.stakedUnits),priceNumerator:BigInt(v.priceNumerator),priceDenominator:BigInt(v.priceDenominator)});
  if(result.status!=='ready')return held(epoch,'position-replay-pending');position=result.position;
  const expected={epoch,sequence:position.sequence,credited:String(position.creditedUnits),stake:v.stakedUnits,numerator:v.priceNumerator,
   denominator:v.priceDenominator,flags:[...position.flags],tokenDays:result.tokenDays,sourceRef:stored.sourceRef};
  for(const field of ['sequence','credited','stake','numerator','denominator','flags','tokenDays']){
   if(canonicalJson(stored[field])!==canonicalJson(expected[field]))dependencies.push({epoch,reason:'position-checkpoint-'+field});
  }
  chain.push(expected);
 }
 if(dependencies.length)return pending(dependencies);
 return {status:'ready',chain,position:{...position,creditedUnits:String(position.creditedUnits)},tokenDays:chain.at(-1).tokenDays};
}
