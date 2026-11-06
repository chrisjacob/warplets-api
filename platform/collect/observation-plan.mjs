import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {seasonExpiry} from '../domain/collections/policy.mjs';
import {genesisSlotEntitlement} from '../domain/economics/vault.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const fail=(c,code)=>{if(!c){const e=new TypeError(code);e.code=code;throw e;}};
function json(raw,max,code){fail(typeof raw==='string'&&utf8(raw).length<=max,code);try{return JSON.parse(raw);}catch{fail(false,code);}}
function wallet(v){try{decode58(v,32);}catch{fail(false,'current-owner-invalid');}return v;}
/** Pure effect planning. Repository supplies freshly verified evidence and
 * current rows, then independently fences these exact effects in its batch. */
export async function prepareCollectionObservation(value,crypto){
 const {input:i,event,asset:a,inventory,vault:v,ownerEvidence:o,operation:op,nowMs}=clone(value);
 fail(a&&inventory&&v&&o,'observation-current-facts-missing');
 fail(time(nowMs)&&time(i.observedMs)&&i.observedMs<=nowMs&&time(a.bind_ms)&&time(a.observed_ms)&&a.bind_ms<=a.observed_ms&&a.observed_ms<=nowMs&&i.observedMs>=a.bind_ms&&time(v.latest_ms)&&v.latest_ms<=nowMs,'observation-current-clock');
 fail(event.assetId===i.assetId&&event.inventoryId===a.inventory_id&&inventory.id===a.inventory_id&&a.id===i.assetId&&v.id===a.id&&canonicalJson({kind:event.kind,from:event.from,to:event.to,observedMs:event.observedMs})===canonicalJson({kind:i.kind,from:i.from,to:i.to,observedMs:i.observedMs}),'observation-event-binding');
 const nft=json(a.asset,16384,'observation-asset-json');fail(JSON.stringify(nft)===a.asset,'observation-asset-json');
 fail(nft.id===a.id&&nft.owner===a.owner&&v.owner===a.owner&&natural(nft.version)&&nft.version===i.expectedAssetVersion&&Number.isInteger(nft.level)&&nft.level>=1&&nft.level<=10&&natural(nft.rerolls)&&time(nft.eligibleAt)&&(nft.pending===null||id(nft.pending)),'observation-asset-state');wallet(a.owner);
 fail(nft.traits&&Object.keys(nft.traits).length===3&&['model','backdrop','symbol'].every(k=>typeof nft.traits[k]==='string'&&nft.traits[k].trim()&&nft.traits[k].length<=128),'observation-asset-traits');
 fail(a.reveal_ms===null||time(a.reveal_ms)&&a.reveal_ms>=a.bind_ms&&a.reveal_ms<=a.observed_ms,'observation-reveal-clock');
 const slot=json(a.slot,4096,'observation-slot'),coords=json(v.coords,4096,'observation-vault-coordinates'),slotKey=json(v.slot_key,4096,'observation-vault-slot');
 fail(canonicalJson(slot)===canonicalJson(coords)&&canonicalJson(coords)===canonicalJson(slotKey),'observation-slot-conflict');
 if(inventory.kind==='season')fail(time(inventory.season_start)&&nft.expiresAt===seasonExpiry(inventory.season_start,nft.level)&&slot.kind==='season'&&slot.seasonId===inventory.id&&Number.isInteger(slot.slotIndex)&&slot.slotIndex>=0&&slot.slotIndex<1000,'observation-season-state');
 else{fail(inventory.kind==='genesis'&&nft.expiresAt===null&&slot.kind==='genesis'&&slot.tranche===inventory.tranche,'observation-genesis-state');try{genesisSlotEntitlement({budget:0n,...slot});}catch{fail(false,'observation-genesis-slot');}}
 const owner=json(o.body,4096,'observation-owner-evidence');fail(JSON.stringify(owner)===o.body,'observation-owner-evidence');fail(o.asset_id===a.id&&id(o.event_id)&&['bind','transfer'].includes(o.kind)&&time(o.observed_ms)&&o.observed_ms>=a.bind_ms&&o.observed_ms<=a.observed_ms&&o.observed_ms<=v.latest_ms&&owner.eventId===o.event_id&&owner.assetId===a.id&&owner.kind===o.kind&&owner.at===new Date(o.observed_ms).toISOString()&&(o.kind==='bind'?owner.owner:owner.to)===a.owner,'observation-owner-conflict');
 const sourceId='evidence:'+i.evidenceReceiptId;let pendingOp=null,after=nft,revealMs=a.reveal_ms,observedMs=i.observedMs,vaultOwner=v.owner,vaultLatest=v.latest_ms;
 if(i.kind==='reveal'){
  fail(a.reveal_ms===null,'asset-already-revealed');fail(nft.pending===null,'reveal-operation-conflict');fail(i.observedMs>=a.observed_ms,'observation-out-of-order');revealMs=i.observedMs;
 }else{
  wallet(i.from);wallet(i.to);fail(i.from===a.owner&&i.to!==i.from&&i.observedMs>o.observed_ms&&i.observedMs%1000===0,'observation-transfer-owner-or-order');
  fail(natural(nft.version+1),'observation-version-overflow');
  if(nft.pending!==null){
   fail(op&&op.id===nft.pending&&op.inventory_id===a.inventory_id&&['upgrade','visual'].includes(op.kind)&&op.settled_ms===null,'observation-pending-operation');
   const body=json(op.operation,16384,'observation-operation-json');fail(JSON.stringify(body)===op.operation&&body.operationId===op.id&&body.commitment===op.commitment&&body.signer===op.owner&&body.kind===op.kind&&[body.targetId,body.materialId].includes(a.id),'observation-operation-binding');pendingOp=op.id;
  }else fail(i.observedMs>=a.observed_ms&&i.observedMs>=v.latest_ms,'observation-out-of-order');
  after={...nft,owner:i.to,version:nft.version+1};observedMs=Math.max(a.observed_ms,i.observedMs);vaultOwner=i.to;vaultLatest=Math.max(v.latest_ms,i.observedMs);
 }
 const conflictId=pendingOp?await crypto.sha256(utf8(canonicalJson(['collection-operation-conflict-v1',pendingOp,a.id,i.evidenceReceiptId]))):null;
 const vaultEventId=i.kind==='transfer'?'collect:'+await crypto.sha256(utf8(canonicalJson(sourceId))):null;
 const vaultEventBodyJson=vaultEventId?JSON.stringify({eventId:vaultEventId,assetId:a.id,kind:'transfer',at:new Date(i.observedMs).toISOString(),from:i.from,to:i.to}):null;
 const collectObservationDigest=await crypto.sha256(utf8(canonicalJson([i.kind,a.id,i.observedMs,i.from,i.to])));
 const result={sourceId,assetId:a.id,kind:i.kind,observedMs:i.observedMs,owner:after.owner,revealMs,assetVersion:after.version,resultKind:pendingOp?'held':'applied',conflictId,operationId:pendingOp,evidenceReceiptId:i.evidenceReceiptId,source:'local-fixture',executable:false};
 const effect={assetBeforeJson:a.asset,assetAfterJson:JSON.stringify(after),collectObservedMs:observedMs,revealMs,slotJson:a.slot,vaultOwner,vaultLatestMs:vaultLatest,vaultCoordsJson:v.coords,vaultSlotKey:v.slot_key,vaultEventId,vaultEventBodyJson,collectObservationDigest};
 fail(utf8(canonicalJson(effect)).length<=49152,'observation-effect-bound');
 return freeze({result,effect,conflict:pendingOp?{id:conflictId,operation_id:pendingOp,asset_id:a.id,evidence_receipt_digest:i.evidenceReceiptId,from_wallet:i.from,to_wallet:i.to,observed_ms:i.observedMs,recorded_ms:nowMs,status:'held'}:null});
}
