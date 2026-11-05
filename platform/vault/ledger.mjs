import {createHash} from 'node:crypto';
import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {launchAllocations} from '../domain/economics/launch.mjs';
import {createSeasonSnapshot,genesisSlotEntitlement,vestedVaultUnits} from '../domain/economics/vault.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const canonicalUnits=s=>{
  if(typeof s!=='string'||!(/^(0|[1-9]\d{0,19})$/).test(s))throw Error('Expected canonical base units.');
  const n=BigInt(s);if(n>(1n<<64n)-1n)throw Error('Base units exceed u64.');return n;
};
const wallet=s=>{decode58(s,32);return s;};
const id=s=>{if(typeof s!=='string'||!(/^[A-Za-z0-9._:-]{1,128}$/).test(s))throw Error('Invalid ID.');return s;};
export function timestamp(s){
 const ms=Date.parse(s);if(!Number.isSafeInteger(ms)||ms<0||new Date(ms).toISOString()!==s||ms%1000)throw Error('Expected UTC whole-second timestamp.');
 return ms;
}
const sec=ms=>BigInt(Math.floor(ms/1000));
function snapshot(ms,rows){
 return createSeasonSnapshot({activatedAt:sec(ms),seasons:rows.map(row=>({id:row.id,startsAt:sec(timestamp(row.startsAt)),levels:row.levels}))});
}
// Import finalized local evidence only. No signer, on-chain claim, or public write path.
export function recordVaultManifest(db,{marketId,originalUnits,seasons=[]}) {
 if(!Array.isArray(seasons)||seasons.length>12)throw Error('Too many concurrent Season snapshots for the pilot.');
 const market=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(id(marketId));
 if(!market)throw Error('Import the market first.');
 const ms=timestamp(JSON.parse(market.body).activatedAt);
 const canonical=seasons.map(({id,startsAt,levels})=>({id,startsAt,levels})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const season=snapshot(ms,canonical),allocation=launchAllocations({supply:canonicalUnits(originalUnits),activeSeasonWeight:season.activeWeight});
 const digest=sha(JSON.stringify([marketId,ms,originalUnits,canonical]));
 return transaction(db,()=>{
  const old=db.prepare('SELECT digest FROM vault_manifests WHERE id=?').get(marketId);
  if(old&&old.digest!==digest)throw Error('Launch snapshot is immutable.');
  if(!old)db.prepare('INSERT INTO vault_manifests VALUES(?,?,?,?,?,?,?)')
    .run(marketId,ms,String(allocation.genesisVault),String(allocation.seasonVault),originalUnits,JSON.stringify(canonical),digest);
  return {marketId,digest,genesisUnits:String(allocation.genesisVault),seasonUnits:String(allocation.seasonVault)};
 });
}
function coordinates(input){
 if(input?.kind==='genesis'){
  const {tranche,level,ordinal}=input;
  genesisSlotEntitlement({budget:0n,tranche,level,ordinal});
  return {kind:'genesis',tranche,level,ordinal};
 }
 if(input?.kind==='season'&&Number.isInteger(input.slotIndex)&&input.slotIndex>=0&&input.slotIndex<1000)
   return {kind:'season',seasonId:id(input.seasonId),slotIndex:input.slotIndex};
 throw Error('Invalid reserved slot.');
}
function slotAmount(manifest,coords){
 if(coords.kind==='genesis')return genesisSlotEntitlement({...coords,budget:BigInt(manifest.genesis_units)});
 const rows=JSON.parse(manifest.seasons);
 if(!rows.some(s=>s.id===coords.seasonId))return 0n;
 return snapshot(manifest.activated_ms,rows).entitlement({budget:BigInt(manifest.season_units),...coords});
}
function entitlement(db,asset,manifest,now){
 const units=slotAmount(manifest,JSON.parse(asset.coords));
 const vested=vestedVaultUnits({allocation:units,activatedAt:sec(manifest.activated_ms),at:sec(now)});
 const claimed=BigInt(db.prepare('SELECT claimed FROM vault_claim_totals WHERE asset_id=? AND launch_id=?').get(asset.id,manifest.id)?.claimed??'0');
 if(claimed>vested)throw Error('Claimed amount exceeds snapshot vesting.');
 return {marketId:manifest.id,allocated:String(units),vested:String(vested),claimed:String(claimed),claimable:String(vested-claimed),manifestDigest:manifest.digest};
}
export function observeAsset(db,event,now=Date.now()) {
 const {eventId,assetId,kind,at}=event;id(eventId);id(assetId);
 const ms=timestamp(at);if(ms>now)throw Error('Future observation.');
 let payload;
 if(kind==='bind')payload={owner:wallet(event.owner),slot:coordinates(event.slot)};
 else if(kind==='transfer')payload={from:wallet(event.from),to:wallet(event.to)};
 else if(kind==='claim')payload={owner:wallet(event.owner),marketId:id(event.marketId),units:String(canonicalUnits(event.units))};
 else throw Error('Unsupported asset observation.');
 const body=JSON.stringify({eventId,assetId,kind,at,...payload});
 return transaction(db,()=>{
  const prior=db.prepare('SELECT body FROM vault_observations WHERE event_id=?').get(eventId);
  if(prior){if(prior.body!==body)throw Error('Observation ID conflict.');return {eventId,replayed:true};}
  const asset=db.prepare('SELECT * FROM vault_assets WHERE id=?').get(assetId);
  if(kind==='bind'){
   if(asset)throw Error('Asset already bound.');
   const coords=JSON.stringify(payload.slot);
   db.prepare('INSERT INTO vault_assets VALUES(?,?,?,?,?)').run(assetId,coords,coords,payload.owner,ms);
  }else{
   if(!asset||asset.latest_ms>ms)throw Error('Missing asset or out-of-order observation.');
   if(kind==='transfer'){
    if(asset.owner!==payload.from||payload.to===payload.from)throw Error('Transfer owner mismatch.');
    db.prepare('UPDATE vault_assets SET owner=?,latest_ms=? WHERE id=?').run(payload.to,ms,assetId);
   }else{
    const manifest=db.prepare('SELECT * FROM vault_manifests WHERE id=?').get(payload.marketId);
    if(!manifest||asset.owner!==payload.owner)throw Error('Claim owner or manifest mismatch.');
    const balance=entitlement(db,asset,manifest,ms),amount=BigInt(payload.units);
    if(amount<=0n||amount>BigInt(balance.claimable))throw Error('Claim exceeds available vested units.');
    db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?) ON CONFLICT(asset_id,launch_id) DO UPDATE SET claimed=excluded.claimed')
      .run(assetId,manifest.id,String(BigInt(balance.claimed)+amount));
    db.prepare('UPDATE vault_assets SET latest_ms=? WHERE id=?').run(ms,assetId);
   }
  }
  db.prepare('INSERT INTO vault_observations VALUES(?,?,?,?,?)').run(eventId,assetId,kind,ms,body);
  return {eventId,replayed:false};
 });
}
export function readAsset(db,assetId,now,after=''){
 const asset=db.prepare('SELECT * FROM vault_assets WHERE id=?').get(assetId);if(!asset)return null;
 const rows=db.prepare('SELECT * FROM vault_manifests WHERE id>? AND activated_ms<=? ORDER BY id LIMIT 26').all(after,now);
 return {assetId,slot:JSON.parse(asset.coords),source:'local-fixture',asOf:new Date(now).toISOString(),
  items:rows.slice(0,25).map(m=>entitlement(db,asset,m,now)),nextCursor:rows.length>25?rows[24].id:null};
}
