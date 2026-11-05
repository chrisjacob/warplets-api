import {prepareVaultManifest} from './projection.mjs';
const status=Object.freeze({sourceStatus:'local-accounting',chainAuthority:'unverified',unit:'base-units',executable:false});
const base=at=>({source:'local-fixture',asOf:new Date(at).toISOString(),...status});
const ownership=ms=>ms===null?null:new Date(ms).toISOString();
const hidden=(asset,at)=>asset.collectionTracked&&(asset.revealMs===null||asset.revealMs>at);
const units=value=>{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>(1n<<64n)-1n)throw new RangeError('Invalid observed Vault base units.');return value;};
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const unique=rows=>new Set(rows.map(r=>r.id)).size===rows.length;

function summary(snapshot){
 const {assets,manifests,claims,evaluatedAtMs:at,wallet}=snapshot;
 const unavailable=reason=>({...base(at),status:'unavailable',reason,assetCount:null,items:[]});
 if(assets.length>100)return unavailable('asset-bound');
 if(assets.some(a=>hidden(a,at)))return unavailable('concealed-metadata');
 if(manifests.length>100)return unavailable('manifest-bound');
 if(claims.length>10000)return unavailable('claim-bound');
 if(assets.some(a=>a.latestMs>at))return unavailable('future-accounting');
 if(!unique(assets)||!unique(manifests)||assets.some(a=>a.owner!==wallet||typeof a.coords!=='string'))return unavailable('invalid-accounting');
 try{
  const owned=new Set(assets.map(a=>a.id)),launches=new Set(manifests.map(m=>m.id)),byClaim=new Map();
  for(const c of claims){const key=JSON.stringify([c.assetId,c.launchId]);
   if(!owned.has(c.assetId)||!launches.has(c.launchId)||byClaim.has(key))return unavailable('invalid-accounting');byClaim.set(key,units(c.claimed));
  }
  const items=manifests.map(m=>{
   if(m.activated_ms>at)throw new RangeError('Future Vault manifest.');
   const project=prepareVaultManifest(m),totals={allocated:0n,vested:0n,claimed:0n,claimable:0n};
   for(const asset of assets){const row=project.project(asset,at,byClaim.get(JSON.stringify([asset.id,m.id]))??'0');for(const k of Object.keys(totals))totals[k]+=BigInt(row[k]);}
   return {marketId:m.id,...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,String(v)])),manifestDigest:m.digest,
    activatedAt:new Date(m.activated_ms).toISOString(),cliffEndsAt:new Date(m.activated_ms+86400000).toISOString(),fullyVestedAt:new Date(m.activated_ms+172800000).toISOString(),...status};
  });
  return {...base(at),status:'complete',reason:null,assetCount:assets.length,items};
 }catch{return unavailable('invalid-accounting');}
}

/** Entire-owner summary is deliberately independent of the displayed page.
 * A concealed holding anywhere suppresses ALL aggregate amounts and count. */
export function projectMemberVaultSnapshot(snapshot){
 if(snapshot.kind!=='member'||snapshot.page.length>26)throw new TypeError('Invalid member Vault snapshot.');
 return frozen({summary:summary(snapshot),items:snapshot.page.slice(0,25).map(row=>({id:row.id,ownerObservedAt:ownership(row.ownerObservedMs),detail:'/api/v1/nfts/'+encodeURIComponent(row.id)+'/vault'})),
  nextCursor:snapshot.page.length>25?snapshot.page[24].id:null,...base(snapshot.evaluatedAtMs)});
}

export function projectVaultAssetSnapshot(snapshot){
 if(snapshot.kind!=='asset'||snapshot.manifests.length>26)throw new TypeError('Invalid asset Vault snapshot.');
 const {asset,evaluatedAtMs:at}=snapshot;
 if(!asset)return Object.freeze({kind:'missing'});
 // This branch runs before JSON parsing or amount/coordinate computation.
 if(hidden(asset,at))return Object.freeze({kind:'hidden'});
 if(asset.latestMs>at)return Object.freeze({kind:'unavailable',reason:'future-accounting'});
 try{
  if(asset.id!==snapshot.assetId||typeof asset.coords!=='string'||!unique(snapshot.manifests))throw new RangeError('Invalid Vault asset identity.');
  const items=snapshot.manifests.slice(0,25).map(m=>{
   if(m.activated_ms>at)throw new RangeError('Future Vault manifest.');
   return {...prepareVaultManifest(m).project(asset,at,units(m.claimed)),...status};
  });
  return frozen({kind:'ready',value:{assetId:asset.id,ownerObservedAt:ownership(snapshot.ownerObservedMs),slot:JSON.parse(asset.coords),items,
   nextCursor:snapshot.manifests.length>25?snapshot.manifests[24].id:null,...base(at)}});
 }catch{return Object.freeze({kind:'unavailable',reason:'invalid-accounting'});}
}
