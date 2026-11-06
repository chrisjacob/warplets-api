import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {seasonExpiry,LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {genesisSlotEntitlement} from '../domain/economics/vault.mjs';
const clone=v=>JSON.parse(canonicalJson(v)),same=(a,b)=>canonicalJson(a)===canonicalJson(b),bytes=v=>utf8(canonicalJson(v)).length;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v),digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),nat=v=>Number.isSafeInteger(v)&&v>=0,time=v=>nat(v)&&v<=8640000000000000;
class Hold extends Error{}
const need=(v,reason)=>{if(!v)throw new Hold(reason);};
function wallet(v){need(typeof v==='string'&&v.length<=44,'current-asset-wallet');try{decode58(v,32);}catch{throw new Hold('current-asset-wallet');}return v;}
function json(text){let value;try{value=JSON.parse(text);}catch{throw new Hold('current-asset-json');}need(JSON.stringify(value)===text,'current-asset-json');return value;}
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
/** Pure bounded legacy graph consistency. The private recovery caller must
 * first independently prove original mint facts and classify accepted modern
 * effects. This helper neither authenticates observations nor grants readiness. */
export async function verifyRetainedLegacyCurrentHistory(input,crypto){
 need(exact(input,['header','operation','entry','asset','vault','initialHistory','vaultObservation','events','observations','history','asOfMs'])&&bytes(input)<=196608,'current-asset-input-bound');
 const q=clone(input),{operation:op,entry,asset:a,vault:v,events,observations,history,asOfMs}=q,assetId=a.id,inventoryId=a.inventory_id,f={header:q.header,initialHistory:q.initialHistory,vaultObservation:q.vaultObservation};
 need(time(asOfMs)&&op.kind==='mint'&&op.inventory_id===inventoryId&&id(op.id)&&id(assetId)&&id(inventoryId)&&entry.operationId===op.id&&nat(entry.ticket)&&entry.ticket<1000&&Number.isInteger(entry.level)&&entry.level>=1&&entry.level<=10,'current-asset-original-entry');
 need(Array.isArray(events)&&Array.isArray(observations)&&Array.isArray(history)&&events.length+observations.length+history.length<=1000,'current-asset-history-bound');
   const nft=json(a.asset),slot=json(a.slot),coords=json(v.coords),slotKey=json(v.slot_key);
   need(exact(nft,['id','owner','level','traits','version','rerolls','eligibleAt','pending','expiresAt'])&&nft.id===assetId&&a.id===assetId&&a.inventory_id===inventoryId&&v.id===assetId,'current-asset-identity');
   wallet(a.owner);wallet(nft.owner);wallet(v.owner);need(a.owner===nft.owner&&a.owner===v.owner,'current-asset-owner');need(nft.pending===null,'current-asset-pending-lock');
   need(nft.level===entry.level&&nat(nft.version)&&nft.rerolls===0&&nft.eligibleAt===0,'current-asset-unproven-progression');
   need(exact(nft.traits,['model','backdrop','symbol'])&&Object.values(nft.traits).every(s=>typeof s==='string'&&s.length<=128&&s.trim().length>0),'current-asset-traits');
   need(a.bind_ms===op.settled_ms&&time(a.bind_ms)&&a.bind_ms%1000===0&&a.bind_ms<=asOfMs&&time(a.observed_ms)&&a.observed_ms>=a.bind_ms&&a.observed_ms<=asOfMs&&time(v.latest_ms)&&v.latest_ms>=a.bind_ms&&v.latest_ms<=asOfMs&&(a.reveal_ms===null||(time(a.reveal_ms)&&a.reveal_ms>=a.bind_ms&&a.reveal_ms<=a.observed_ms)),'current-asset-clock');
   need(same(slot,coords)&&same(slot,slotKey),'current-asset-slot');
   if(f.header.kind==='genesis'){need(exact(slot,['kind','tranche','level','ordinal'])&&slot.kind==='genesis'&&slot.tranche===f.header.tranche&&slot.level===entry.level&&nft.expiresAt===null,'current-asset-genesis-slot');try{genesisSlotEntitlement({budget:0n,...slot});}catch{throw new Hold('current-asset-genesis-slot');}}
   else{const lower=LEVEL_QUOTAS.slice(0,entry.level-1).reduce((n,v)=>n+v,0);let expiry;try{expiry=seasonExpiry(f.header.seasonStart,entry.level);}catch{throw new Hold('current-asset-season-slot');}need(exact(slot,['kind','seasonId','slotIndex'])&&slot.kind==='season'&&slot.seasonId===inventoryId&&nat(slot.slotIndex)&&slot.slotIndex>=lower&&slot.slotIndex<lower+LEVEL_QUOTAS[entry.level-1]&&nft.expiresAt===expiry,'current-asset-season-slot');}
   const visuals={model:nft.traits.model,backdrop:nft.traits.backdrop,symbol:nft.traits.symbol};need(await crypto.sha256(utf8(JSON.stringify(['mint',op.id,assetId,op.proof_id,op.settled_ms,entry.ticket,op.commitment,visuals])))===op.evidence_digest,'current-asset-original-traits-digest');
   need(same(history,f.initialHistory),'current-asset-level-history-unsupported');
   const bind=events.filter(e=>e.kind==='bind');need(bind.length===1&&same(bind[0],f.vaultObservation),'current-asset-bind-history');
   const initial={eventId:'collect:'+op.id,assetId,kind:'bind',at:new Date(op.settled_ms).toISOString(),owner:op.owner,slot};need(bind[0].body===JSON.stringify(initial),'current-asset-original-bind');wallet(op.owner);
   const transfers=events.filter(e=>e.kind==='transfer');need(events.length===transfers.length+1,'current-asset-vault-history-unsupported');
   const transferById=new Map();for(const e of transfers){const b=json(e.body);need(exact(b,['eventId','assetId','kind','at','from','to'])&&id(e.event_id)&&e.asset_id===assetId&&b.eventId===e.event_id&&b.assetId===assetId&&b.kind==='transfer'&&time(e.observed_ms)&&e.observed_ms%1000===0&&e.observed_ms>=a.bind_ms&&e.observed_ms<=asOfMs&&b.at===new Date(e.observed_ms).toISOString()&&b.from!==b.to,'current-asset-transfer-history');wallet(b.from);wallet(b.to);transferById.set(e.event_id,{...e,from:b.from,to:b.to});}
   let revealMs=null,observedMs=a.bind_ms,transferCount=0;const matched=new Set();
   for(const o of observations){need(id(o.source_id)&&o.asset_id===assetId&&['reveal','transfer'].includes(o.event_kind)&&time(o.observed_ms)&&o.observed_ms>=a.bind_ms&&o.observed_ms<=asOfMs&&digest(o.digest),'current-asset-observation');observedMs=Math.max(observedMs,o.observed_ms);let from=null,to=null;
    if(o.event_kind==='reveal'){need(revealMs===null,'current-asset-duplicate-reveal');revealMs=o.observed_ms;}
    else{const eid='collect:'+await crypto.sha256(utf8(JSON.stringify(o.source_id))),e=transferById.get(eid);need(e&&!matched.has(eid)&&e.observed_ms===o.observed_ms,'current-asset-transfer-pair');matched.add(eid);from=e.from;to=e.to;transferCount++;}
    need(await crypto.sha256(utf8(JSON.stringify([o.event_kind,assetId,o.observed_ms,from,to])))===o.digest,'current-asset-observation-digest');
   }
   need(matched.size===transfers.length,'current-asset-unpaired-vault-transfer');
   // Rowid is not a portable historical ordering. At equal timestamps a unique
   // from-owner chain is required; ambiguous cycles explicitly hold.
   let owner=op.owner,latestMs=a.bind_ms;const pending=[...transferById.values()].sort((a,b)=>a.observed_ms-b.observed_ms);
   while(pending.length){const at=pending[0].observed_ms,group=[];while(pending.length&&pending[0].observed_ms===at)group.push(pending.shift());while(group.length){const next=group.filter(e=>e.from===owner);need(next.length===1,'current-asset-transfer-order-unsupported');owner=next[0].to;group.splice(group.indexOf(next[0]),1);}latestMs=at;}
   need(owner===a.owner&&nft.version===transferCount&&v.latest_ms===latestMs&&a.observed_ms===observedMs&&a.reveal_ms===revealMs,'current-asset-replayed-current-state');
   const current={owner,level:nft.level,version:nft.version,rerolls:nft.rerolls,eligibleAt:nft.eligibleAt,expiresAt:nft.expiresAt,revealMs,observedMs},counts={vaultEvents:events.length,transfers:transferCount,reveals:revealMs===null?0:1,levelHistory:history.length,completedProgressions:0};
   const currentAssetDigest=await crypto.sha256(utf8(canonicalJson({asset:a,vault:v})));
 return freeze({kind:'verified',currentAssetDigest,current,counts,verification:'retained-legacy-current-graph',originalIngestionAuthenticated:false,readiness:false});
}
