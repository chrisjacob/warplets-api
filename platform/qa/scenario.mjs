import {createHash} from 'node:crypto';
import {encode58,decode58} from '../server/base58.mjs';
export const DAY=86_400_000;
export const DEFAULT_QA_OWNER='4nQTuFuY38vevToXAuMwT3nm4SFVfuRRWMEXRm68JeX9';
export const QA_SUPPLY='402600000000000';
export const qaAddress=(seed,label)=>encode58(createHash('sha256').update('10x-synthetic-qa:'+seed+':'+label).digest());
const iso=ms=>new Date(ms).toISOString();
/** Deterministic synthetic data, never prices from a live feed or real rewards. */
export function buildPerformanceScenario({wallet=DEFAULT_QA_OWNER,seed='three-month-v1',asOf=new Date(Math.floor(Date.now()/1000)*1000).toISOString(),participantCount=250,missingPrices=false}={}){
 decode58(wallet,32);const now=Date.parse(asOf);
 if(!Number.isSafeInteger(now)||new Date(now).toISOString()!==asOf||now%1000||now<180*DAY)throw Error('Use a canonical UTC asOf with whole seconds.');
 if(!Number.isInteger(participantCount)||participantCount<150||participantCount>1000)throw Error('Use 150–1000 participants.');
 if(typeof seed!=='string'||!seed.length||seed.length>100)throw Error('Invalid QA seed.');
 const participants=Array.from({length:participantCount-1},(_,i)=>({wallet:qaAddress(seed,'participant-'+i),label:'Synthetic participant '+String(i+1).padStart(3,'0')+(i===0?' — long community display name for layout review':'')}));
 participants.push({wallet,label:'Synthetic QA owner (outside top 100)'});
 const tokens=Array.from({length:90},(_,i)=>{
  const age=90-i,id=age===3?'demo-att':'qa-att-'+String(age).padStart(3,'0');
  const launchAt=now-age*DAY+10000,price=1000+i*100,peakMultiple=3+(i*41)%997,currentMultiple=1+(i*7)%Math.min(peakMultiple,25);
  const observation=(label,at,multiple,quality='accepted')=>({id:'synthetic-'+id+'-'+label,at:iso(at),attOgNumerator:String(multiple),attOgDenominator:'1',ogUsdMicros:String(price),ogObservedAt:iso(at),source:'synthetic-local-qa-v1',poolId:qaAddress(seed,'pool-'+id),quality,...(quality==='rejected'?{reason:'Synthetic invalid pool quote; excluded from valuation'}:{})});
  return {id,symbol:age===3?'DEMOATT':'QAATT'+String(age).padStart(3,'0'),decimals:age===3?0:6,supplyUnits:age===3?'402600000':QA_SUPPLY,launchPriceMicros:String(price),launchAt:iso(launchAt),observations:missingPrices&&i===89?[]:[observation('launch',launchAt,1),observation('brief-peak',launchAt+300000,peakMultiple),observation('after-peak',launchAt+301000,currentMultiple),observation('invalid',now-30000,99999999,'rejected'),observation('current',now-(missingPrices&&i===88?DAY:60000),currentMultiple)]};
 });
 const rewards=[];
 for(let day=0;day<90;day++){
  const awardedMs=now-(89-day)*DAY-600000,available=tokens.filter(t=>Date.parse(t.launchAt)<=awardedMs&&t.observations.length&&t.id!==tokens[88].id);
  for(let i=0;i<participants.length;i++){
   const token=available[(i+day*7)%available.length],awarded=BigInt((participants.length-i)*(20+day%9))*10n**BigInt(token.decimals);
   const vested=day===89?awarded/2n:awarded,claimed=day<80&&i%3===0?vested/4n:0n;
   rewards.push({id:'synthetic-award-'+day+'-'+i,wallet:participants[i].wallet,tokenId:token.id,category:['nfts','stake','earn'][(day+i)%3],awardedUnits:String(awarded),vestedUnits:String(vested),claimedUnits:String(claimed),awardedAt:iso(awardedMs)});
  }
 }
 // Explicit unknown-price and stale-current cases, separate from the main review wallet.
 for(const [index,token] of [[participants.length-2,tokens[89]],[participants.length-3,tokens[88]]])rewards.push({id:'synthetic-unknown-'+index,wallet:participants[index].wallet,tokenId:token.id,category:'earn',awardedUnits:'1000000',vestedUnits:'500000',claimedUnits:'0',awardedAt:iso(now-600000)});
 return {schemaVersion:1,mode:'synthetic-local',asOf,tokens,participants,rewards};
}
