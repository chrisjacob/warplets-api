import type { NetworkWarplets } from '../../../shared/network/model';
const address=(value:unknown)=>typeof value==='string'&&/^0x[a-f0-9]{40}$/i.test(value)&&!/^0x0{40}$/i.test(value)?value.toLowerCase():null;
const fid=(value:unknown)=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
export async function refreshNetworkWarplets(db:D1Database):Promise<{summary:NetworkWarplets;holders:Set<number>}> {
  const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('warplets_metadata','warplet_market_state','wallet_farcaster_links')").all<{name:string}>();
  const names=new Set(tables.results.map(row=>row.name)),at=Date.now();
  if(!names.has('warplets_metadata')||!names.has('warplet_market_state'))return {summary:{status:'unavailable',calculatedAt:at,sourceUpdatedAt:null,tokens:0,resolvedTokens:0,unresolvedTokens:0,holderFids:0},holders:new Set()};
  const metadata=await db.prepare('SELECT token_id,warplet_wallet,fid_value FROM warplets_metadata').all<{token_id:number;warplet_wallet:string;fid_value:number}>();
  const current=await db.prepare('SELECT token_id,owner_wallet,owner_fid,owner_checked_at,owner_event_at FROM warplet_market_state').all<{token_id:number;owner_wallet:string|null;owner_fid:number|null;owner_checked_at:string|null;owner_event_at:string|null}>();
  const cached=names.has('wallet_farcaster_links')?(await db.prepare('SELECT wallet,fid FROM wallet_farcaster_links').all<{wallet:string;fid:number}>()).results:[];
  const verified=await db.prepare('SELECT address AS wallet,fid FROM network_wallet_links').all<{wallet:string;fid:number}>();
  const identities=new Map<string,Set<number>>();
  for(const row of [...cached,...verified.results]){const wallet=address(row.wallet),id=fid(row.fid);if(wallet&&id){const ids=identities.get(wallet)??new Set<number>();ids.add(id);identities.set(wallet,ids);}}
  const market=new Map(current.results.map(row=>[row.token_id,row]));
  const counts=new Map<number,number>();let resolved=0,updated:number|null=null;
  for(const token of metadata.results){
    const row=market.get(token.token_id),originalWallet=address(token.warplet_wallet);
    // An observed transfer/burn/unknown current owner must never resurrect the
    // original recipient. Only untouched allocation rows can use that fallback.
    const observed=Boolean(row&&(row.owner_wallet!==null||row.owner_fid!==null||row.owner_checked_at||row.owner_event_at));
    const wallet=observed?address(row!.owner_wallet):originalWallet;
    for(const date of [row?.owner_checked_at,row?.owner_event_at]){const time=Date.parse(date??'');if(Number.isFinite(time))updated=Math.max(updated??time,time);}
    if(!wallet)continue;
    const ids=new Set(identities.get(wallet)??[]);
    const recorded=fid(row?.owner_fid);
    if(observed&&recorded)ids.add(recorded);
    if(wallet===originalWallet){const originalFid=fid(token.fid_value);if(originalFid)ids.add(originalFid);}
    if(ids.size!==1)continue;
    const id=[...ids][0];counts.set(id,(counts.get(id)??0)+1);resolved++;
  }
  // Publish a derived index atomically; never mutate or refresh Warplets data.
  await db.batch([
    db.prepare('DELETE FROM network_warplet_holders'),
    db.prepare("INSERT INTO network_warplet_holders(fid,token_count,calculated_at) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),? FROM json_each(?)").bind(at,JSON.stringify([...counts])),
  ]);
  return {holders:new Set(counts.keys()),summary:{status:'ready',calculatedAt:at,sourceUpdatedAt:updated,tokens:metadata.results.length,resolvedTokens:resolved,unresolvedTokens:metadata.results.length-resolved,holderFids:counts.size}};
}
