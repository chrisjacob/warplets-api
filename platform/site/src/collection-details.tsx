import type { Inventory, Stage, Asset } from './models';
import { Facts, utc } from './common';
export function StageEvidence({stage:s}:{stage:Stage}){
  const eligibility=s.eligibility?.status??(s.status==='awaiting-snapshot'||s.eligible===null?'unknown':s.eligible?'eligible':'ineligible');
  const reasons={'eligible':'Eligible for a local reservation','not-signed-in':'Sign in to check the wallet limit','opening-hold':'Opening is held for the published dependency','stage-scheduled':'The stage has not opened','stage-closed':'The stage has closed','sold-out':'No stage or shared inventory remains','snapshot-pending':'Complete opening-cut evidence is pending','not-on-list':'Wallet is absent from the fixed eligibility list','wallet-limit':'The per-stage wallet limit has been used','operator-only':'Founder allocations require the separate operator command'};
  return <><Facts items={[
    ['Published',s.publishedAt?utc(s.publishedAt):'Unavailable'],['Terms digest',s.termsDigest??'Unavailable'],
    ['Eligibility',eligibility],['Evidence reason',s.eligibility?.reason??'No detailed evidence supplied'],
    ...(s.eligibility?.cutoffAt?[['Free-stage ownership cut',utc(s.eligibility.cutoffAt)] as [string,string]]:[]),
  ]}/>{s.reservationStatus&&<Facts items={[
    ['Current reservation',s.reservationStatus.status==='available'?'Available for a local request':s.reservationStatus.status==='unknown'?'Availability is unknown':'Unavailable for a local request'],['Reservation reason',reasons[s.reservationStatus.reason]],
    ['Stage reservations used',s.reservationStatus.used??'Unknown'],['Wallet slots remaining',s.reservationStatus.remaining??'Unknown'],
    ['Accepted opening-cut digest',s.reservationStatus.snapshotId??'Not recorded'],['Availability as of',utc(s.reservationStatus.asOf)],
  ]}/>}<p>Fixed-list eligibility and current reservation availability are separate. All reservations remain local previews.</p>{s.type==='free'&&<p>Eligibility uses revealed Genesis Level 1 ownership at the published opening time. Later evidence does not move this cut.</p>}</>;
}
export function InventoryEvidence({inventory:i}:{inventory:Inventory}){
  return <><Facts items={[
    ['Priced-stage allocations',i.counts.paid],['Free-stage allocations',i.counts.free],['Founder-stage allocations',i.counts.founder],
    ['Awaiting fulfillment',i.counts.pending],['Slots available',i.counts.unsold],['Unminted reserve',i.counts.unmintedReserve],
    ['Concealed NFTs',i.concealedCount??'Unavailable'],['Source',i.source??'Unavailable'],['Projection as of',i.asOf?utc(i.asOf):'Unavailable'],
  ]}/><p>Local allocations do not establish verified sales, payments or revenue. Later launch prices and Sydney launch hours remain unset.</p>
  {i.initialLevelQuotas&&<details><summary>Initial Level quotas and public reveals</summary><Facts items={i.initialLevelQuotas.map((n,index)=>[
    'Level '+(index+1),n+' initial slots; '+(i.revealedLevelCounts?.[index]??'unavailable')+' publicly revealed NFTs'])}/>
    <p>Revealed counts describe current public Levels; upgrades can change them. Concealed Levels are withheld.</p></details>}
  {i.seasonExpiries&&<details><summary>Season Level expiry schedule</summary><Facts items={i.seasonExpiries.map(e=>[
    'Level '+e.level,utc(e.expiresAt)+' · '+e.remainingMs+' ms remaining at projection time'])}/>
    <p>Late mints inherit the same expiry from the original Season start. Expiry or a later Level change does not erase past allocations or restart their vesting.</p></details>}</>;
}
export function AssetEvidence({asset:a}:{asset:Asset}){
  return <><Facts items={[
    ['Owner evidence observed',a.ownerObservedAt?utc(a.ownerObservedAt):'Unavailable'],['Evidence',a.evidenceStatus??'Unavailable'],
    ...(a.revealStatus==='revealed'?[
      ['Revealed',a.revealedAt?utc(a.revealedAt):'Unavailable'],['Benefit expiry',a.expiresAt?utc(a.expiresAt):'Permanent'],
      ['Visual rerolls',a.rerolls??'Unavailable'],['Next reroll',a.nextRerollAt?utc(a.nextRerollAt):'No recorded cooldown'],
    ] as [string,React.ReactNode][]:[]),
  ]}/><p>Historical allocations retain their original vesting clock after expiry, transfer or progression.</p></>;
}
export function eligibleMaterials(assets:Asset[],target:Asset,wallet:string){
  return assets.filter(a=>a.id!==target.id&&a.owner===wallet&&a.owner===target.owner&&a.inventoryId===target.inventoryId&&
    a.revealStatus==='revealed'&&a.level===target.level&&a.version!==undefined&&!!a.expiresAt&&!a.operationPending);
}
