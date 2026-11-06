// Synthetic local current-state rows only. No custody, quote or mint authority.
import {createCollection} from '../../collect/store.mjs';
import {observeAsset} from '../../vault/ledger.mjs';
import {seasonExpiry} from '../../domain/collections/policy.mjs';
import {encode58} from '../../server/base58.mjs';
export function seedCollectionContext(db){
 const wallet=encode58(new Uint8Array(32).fill(7)),other=encode58(new Uint8Array(32).fill(8)),start=Date.UTC(2026,0,1),nowMs=Date.UTC(2026,1,15),inventoryId='synthetic-context-season';
 createCollection(db,{id:inventoryId,kind:'season',seasonStart:start});
 const ids=(level,role)=>'synthetic-l'+String(level).padStart(2,'0')+'-'+role;
 for(let level=1;level<=10;level++)for(const [index,role] of ['target','material'].entries()){
  const id=ids(level,role),bindMs=start+1000,observedMs=start+2000,slot={kind:'season',seasonId:inventoryId,slotIndex:(level-1)*2+index};
  const asset={id,owner:wallet,level,traits:{model:'Synthetic ink',backdrop:'Synthetic sky',symbol:'Synthetic star'},version:0,rerolls:0,eligibleAt:0,pending:null,expiresAt:seasonExpiry(start,level)};
  db.prepare('INSERT INTO collect_assets VALUES(?,?,?,?,?,?,?,?)').run(id,inventoryId,wallet,bindMs,observedMs,observedMs,JSON.stringify(slot),JSON.stringify(asset));
  observeAsset(db,{eventId:'bind-'+id,assetId:id,kind:'bind',at:new Date(bindMs).toISOString(),owner:wallet,slot},nowMs);
 }
 return {wallet,other,start,nowMs,inventoryId,ids,request:(level,kind='upgrade')=>({kind,targetId:ids(level,'target'),expectedTargetVersion:0,...(kind==='upgrade'?{materialId:ids(level,'material'),expectedMaterialVersion:0}:{})})};
}
