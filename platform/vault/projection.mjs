import {createSeasonSnapshot,genesisSlotEntitlement,vestedVaultUnits} from '../domain/economics/vault.mjs';
export function timestamp(s){
 const ms=Date.parse(s);if(!Number.isSafeInteger(ms)||ms<0||new Date(ms).toISOString()!==s||ms%1000)throw Error('Expected UTC whole-second timestamp.');
 return ms;
}
const sec=ms=>BigInt(Math.floor(ms/1000));
export function snapshot(ms,rows){
 return createSeasonSnapshot({activatedAt:sec(ms),seasons:rows.map(row=>({id:row.id,startsAt:sec(timestamp(row.startsAt)),levels:row.levels}))});
}
function slotAmount(manifest,coords){
 if(coords.kind==='genesis')return genesisSlotEntitlement({...coords,budget:BigInt(manifest.genesis_units)});
 const rows=JSON.parse(manifest.seasons);
 if(!rows.some(s=>s.id===coords.seasonId))return 0n;
 return snapshot(manifest.activated_ms,rows).entitlement({budget:BigInt(manifest.season_units),...coords});
}
export function projectEntitlement(asset,manifest,now,claimedUnits){
 const units=slotAmount(manifest,JSON.parse(asset.coords));
 const vested=vestedVaultUnits({allocation:units,activatedAt:sec(manifest.activated_ms),at:sec(now)});
 const claimed=BigInt(claimedUnits);
 if(claimed>vested)throw Error('Claimed amount exceeds snapshot vesting.');
 return {activatedAt:new Date(manifest.activated_ms).toISOString(),cliffEndsAt:new Date(manifest.activated_ms+86400000).toISOString(),fullyVestedAt:new Date(manifest.activated_ms+172800000).toISOString(),marketId:manifest.id,allocated:String(units),vested:String(vested),claimed:String(claimed),claimable:String(vested-claimed),manifestDigest:manifest.digest};
}
