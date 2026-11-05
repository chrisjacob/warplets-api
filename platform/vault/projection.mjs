import {createSeasonSnapshot,genesisSlotEntitlement,vestedVaultUnits} from '../domain/economics/vault.mjs';
export function timestamp(s){
 const ms=Date.parse(s);if(!Number.isSafeInteger(ms)||ms<0||new Date(ms).toISOString()!==s||ms%1000)throw Error('Expected UTC whole-second timestamp.');
 return ms;
}
const sec=ms=>BigInt(Math.floor(ms/1000));
export function snapshot(ms,rows){
 return createSeasonSnapshot({activatedAt:sec(ms),seasons:rows.map(row=>({id:row.id,startsAt:sec(timestamp(row.startsAt)),levels:row.levels}))});
}
/** Reuse one immutable Season allocation snapshot for every asset in a bounded
 * read. Mint/transfer/current metadata never change this launch denominator. */
export function prepareVaultManifest(value){
 const manifest={...value};let seasonRows,seasonSnapshot;
 function slotAmount(coords){
  if(coords.kind==='genesis')return genesisSlotEntitlement({...coords,budget:BigInt(manifest.genesis_units)});
  seasonRows??=JSON.parse(manifest.seasons);
  if(!seasonRows.some(s=>s.id===coords.seasonId))return 0n;
  seasonSnapshot??=snapshot(manifest.activated_ms,seasonRows);
  return seasonSnapshot.entitlement({budget:BigInt(manifest.season_units),...coords});
 }
 return Object.freeze({project(asset,now,claimedUnits){
 const units=slotAmount(JSON.parse(asset.coords));
 const vested=vestedVaultUnits({allocation:units,activatedAt:sec(manifest.activated_ms),at:sec(now)});
 const claimed=BigInt(claimedUnits);
 if(claimed>vested)throw Error('Claimed amount exceeds snapshot vesting.');
 return {activatedAt:new Date(manifest.activated_ms).toISOString(),cliffEndsAt:new Date(manifest.activated_ms+86400000).toISOString(),fullyVestedAt:new Date(manifest.activated_ms+172800000).toISOString(),marketId:manifest.id,allocated:String(units),vested:String(vested),claimed:String(claimed),claimable:String(vested-claimed),manifestDigest:manifest.digest};
 }});
}
export function projectEntitlement(asset,manifest,now,claimedUnits){
 return prepareVaultManifest(manifest).project(asset,now,claimedUnits);
}
