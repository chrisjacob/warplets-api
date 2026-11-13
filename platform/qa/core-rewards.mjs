import {readAsset} from '../vault/ledger.mjs';
import {describeFarm} from '../stake/projection.mjs';
import {readWalletClaims} from '../earn/workflow.mjs';

/** Derive the selected owner's snapshot quantities from the same canonical
 * readers as the operational demo. Other participants are synthetic history. */
export function readCoreRewards(db,{wallet,asOf}){
 const now=Date.parse(asOf),rewards=[];
 for(const asset of db.prepare('SELECT id FROM vault_assets WHERE owner=? ORDER BY id').all(wallet)){
  let after='';do{
   const page=readAsset(db,asset.id,now,after);
   for(const r of page.items)if(BigInt(r.allocated)>0n)rewards.push({id:'core-nft:'+asset.id+':'+r.marketId,wallet,tokenId:r.marketId,category:'nfts',awardedUnits:r.allocated,vestedUnits:r.vested,claimedUnits:r.claimed,awardedAt:r.activatedAt});
   after=page.nextCursor;
  }while(after);
 }
 for(const farm of db.prepare('SELECT * FROM stake_fixture_farms ORDER BY market_id').all()){
  if(farm.treasury_fee_bps!==0)throw Error('QA core alignment requires explicit zero-fee synthetic farms.');
  const events=db.prepare('SELECT * FROM stake_fixture_events WHERE market_id=? AND at_ms<=? ORDER BY at_ms,seq').all(farm.market_id,now),r=describeFarm(farm,now,wallet,events);
  // This timestamp dates the cumulative observation, not a distribution event.
  if(BigInt(r.earnedGrossUnits??'0')>0n)rewards.push({id:'core-stake:'+farm.market_id+':'+wallet,kind:'accrual-snapshot',wallet,tokenId:farm.market_id,category:'stake',awardedUnits:r.earnedGrossUnits,vestedUnits:r.earnedGrossUnits,claimedUnits:r.harvestedGrossUnits,awardedAt:asOf});
 }
 let after=0;do{
  const page=readWalletClaims(db,{wallet,nowMs:now,after});
  for(const r of page.items)if(BigInt(r.awardUnits)>0n){
   const allocation=db.prepare('SELECT starts_ms FROM earn_allocations WHERE token_id=? AND day=?').get(r.tokenId,r.day);
   rewards.push({id:'core-earn:'+r.tokenId+':'+r.day+':'+wallet,wallet,tokenId:r.tokenId,category:'earn',awardedUnits:r.awardUnits,vestedUnits:r.vestedUnits,claimedUnits:'0',awardedAt:new Date(allocation.starts_ms).toISOString()});
  }
  after=page.nextCursor;
 }while(after!==null);
 return rewards;
}

export function alignOwnerRewards(db,snapshot,wallet){
 const rewards=readCoreRewards(db,{wallet,asOf:snapshot.asOf});
 snapshot.rewards=[...snapshot.rewards.filter(r=>r.wallet!==wallet),...rewards];
 snapshot.participants.find(p=>p.wallet===wallet).label='Synthetic QA owner (core-aligned)';
 return {wallet,asOf:snapshot.asOf,records:rewards.length,categories:Object.fromEntries(['nfts','stake','earn'].map(category=>[category,rewards.filter(r=>r.category===category).length]))};
}
