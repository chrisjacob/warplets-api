import {transaction} from '../storage/database.mjs';
import {projectEntitlement} from './projection.mjs';
export function ownerObservedAt(db,id){
 const row=db.prepare("SELECT observed_ms FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1").get(id);
 return row?new Date(row.observed_ms).toISOString():null;
}
/** Synchronous bounded local-ledger snapshot. Never aggregate a visible subset.
 * Any concealed tracked asset suppresses all amounts; no hidden Level differences.
 * Completeness is only for this local fixture ledger, never a chain coverage claim.
 */
export function memberVaultSummary(db,wallet,now){
 return transaction(db,()=>{
 const base={source:'local-fixture',asOf:new Date(now).toISOString()};
 const unavailable=reason=>({...base,status:'unavailable',reason,assetCount:null,items:[]});
 const assets=db.prepare('SELECT * FROM vault_assets WHERE owner=? ORDER BY id LIMIT 101').all(wallet);
 if(assets.length>100)return unavailable('asset-bound');
 if(assets.some(a=>{const c=db.prepare('SELECT reveal_ms FROM collect_assets WHERE id=?').get(a.id);return c&&(c.reveal_ms===null||c.reveal_ms>now);} ))return unavailable('concealed-metadata');
 const manifests=db.prepare('SELECT * FROM vault_manifests WHERE activated_ms<=? ORDER BY id LIMIT 101').all(now);
 if(manifests.length>100)return unavailable('manifest-bound');
 const items=manifests.map(manifest=>{
  const totals={allocated:0n,vested:0n,claimed:0n,claimable:0n};
  for(const asset of assets){
   const claimed=db.prepare('SELECT claimed FROM vault_claim_totals WHERE asset_id=? AND launch_id=?').get(asset.id,manifest.id)?.claimed??'0';
   const row=projectEntitlement(asset,manifest,now,claimed);
   for(const key of Object.keys(totals))totals[key]+=BigInt(row[key]);
  }
  return {marketId:manifest.id,...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,String(v)])),manifestDigest:manifest.digest,
   activatedAt:new Date(manifest.activated_ms).toISOString(),cliffEndsAt:new Date(manifest.activated_ms+86400000).toISOString(),fullyVestedAt:new Date(manifest.activated_ms+172800000).toISOString()};
 });
 return {...base,status:'complete',reason:null,assetCount:assets.length,items};
 });
}
