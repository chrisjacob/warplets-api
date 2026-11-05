import type {Asset} from './models';
import {useRuntimeQuery} from './capabilities';
import {sdk} from './sdk';
import {Facts,Loaded,utc} from './common';

/** Display each revealed, owner-bound asset independently. A page of historical
 * allocations never becomes a combined balance or a fiat estimate. */
export function ProgressionAssetContext({asset,wallet,label}:{asset:Asset;wallet:string;label:'Target'|'Material'}){
 const authorized=asset.owner===wallet&&asset.revealStatus==='revealed';
 const historical=useRuntimeQuery('/api/v1/nfts/{id}/vault',{
  queryKey:['private',wallet,'solana','progression-vault',asset.id,asset.version],enabled:authorized,
  queryFn:({signal})=>sdk.nftVault(asset.id,undefined,signal),staleTime:0,
 });
 if(!authorized)return <p>{label} details are unavailable. Refresh ownership and reveal evidence.</p>;
 return <section className="record" aria-label={label+' before progression'}>
  <h3>{label} before progression</h3><Facts items={[
   ['NFT',asset.id],['Season',asset.inventoryId],['Current Level',asset.level??'Unavailable'],['Asset version',asset.version??'Unavailable'],
   ['Current benefit expiry',asset.expiresAt?utc(asset.expiresAt):'Unavailable'],['Owner observed',asset.ownerObservedAt?utc(asset.ownerObservedAt):'Unavailable'],
   ['Completed visual rerolls',asset.rerolls??'Unavailable'],['Current reroll cooldown',asset.nextRerollAt?utc(asset.nextRerollAt):'No recorded cooldown'],
  ]}/><h4>{label} historical Vault allocations</h4>
  <Loaded query={historical}>{page=><>
   <p>Local allocation evidence as of {utc(page.asOf)}. {page.nextCursor===null?'All recorded allocation rows returned.':'Only the first allocation page is shown; this is not a complete balance.'}</p>
   {page.items.length?<ul className="records">{page.items.map(row=><li key={row.marketId}><strong>{row.marketId}</strong><Facts items={[
    ['Allocated base units',row.allocated],['Vested base units',row.vested],['Claimed base units',row.claimed],['Available base units',row.claimable],
    ['Original activation',row.activatedAt?utc(row.activatedAt):'Unavailable'],['Cliff ends',row.cliffEndsAt?utc(row.cliffEndsAt):'Unavailable'],
    ['Fully vested',row.fullyVestedAt?utc(row.fullyVestedAt):'Unavailable'],['Manifest digest',row.manifestDigest],
   ]}/></li>)}</ul>:<p>No allocation rows are recorded for this NFT in the local ledger.</p>}
  </>}</Loaded><p>Amounts stay separate by NFT and token. Fiat pricing is unavailable. Progression preserves these historical allocations and claimed amounts.</p>
 </section>;
}
