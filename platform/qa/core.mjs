import {seedDemo} from '../scripts/demo-data.mjs';
import {importMarket} from '../markets/catalog.mjs';
import {seedFarm,observeFarm} from '../stake/farms.mjs';
import {recordVaultManifest} from '../vault/ledger.mjs';
import {createCollection,publishCollectionStage,reserveMint,inspectOperation,fulfillMint,observeCollectionAsset} from '../collect/store.mjs';
import {addCampaign,submitContent,recordReview,finalizeBoard,recordAllocation} from '../earn/workflow.mjs';
import {recordStakeRead} from '../earn/fixtures.mjs';
import {registerCollection,recordOwnership} from '../earn/components.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {DAY,QA_SUPPLY,qaAddress} from './scenario.mjs';
const iso=ms=>new Date(ms).toISOString();
/** Writes only into the fresh database supplied by the isolated QA command. */
export function seedCoreScenario(db,snapshot,{wallet,seed='three-month-v1',mintCountPerSeason=60}={}){
 const now=Date.parse(snapshot.asOf),demo=seedDemo(db,{wallet,now}),largeHolder=snapshot.participants[0].wallet;
 if(!Number.isInteger(mintCountPerSeason)||mintCountPerSeason<1||mintCountPerSeason>100)throw Error('Mint fixture bound exceeded.');
 const seasons=[];
 for(let offset=3;offset>=1;offset--){
  const d=new Date(now),start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-offset,1),id='qa-season-'+iso(start).slice(0,7),opens=Math.max(start+3*DAY,now-90*DAY),stageId='synthetic-history';
  createCollection(db,{id,kind:'season',seasonStart:start});
  publishCollectionStage(db,{inventoryId:id,stage:{id:stageId,type:'whitelist',publishedAt:opens-2*DAY,opensAt:opens,closesAt:now+7*DAY,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[wallet,largeHolder],walletLimit:mintCountPerSeason}},now);
  seasons.push({id,startsAt:iso(start),levels:LEVEL_QUOTAS.flatMap((count,i)=>Array(count).fill(i+1))});
  for(let n=0;n<mintCountPerSeason;n++){
   const owner=n<Math.floor(mintCountPerSeason*.3)?wallet:largeHolder,at=opens+n*4000,assetId=id+'-synthetic-'+String(n).padStart(3,'0');
   const {operation}=reserveMint(db,{inventoryId:id,stageId,wallet:owner,requestKey:'qa-'+assetId,now:at});
   fulfillMint(db,{operationId:operation.id,assetId,commitment:inspectOperation(db,operation.id).commitment,proofId:'synthetic-proof-'+assetId,finalized:true,at:at+1000,ticket:n*127%(1000-n),traits:{model:'Synthetic '+['Fox','Comet','Robot'][n%3],backdrop:'Synthetic '+['Neon','Twilight','Ocean'][n%3],symbol:'Synthetic '+['Star','Wave','Spark'][n%3]}});
   observeCollectionAsset(db,{sourceId:'synthetic-reveal-'+assetId,kind:'reveal',assetId,at:at+2000,finalized:true});
  }
 }
 seasons.push({id:demo.seasonId,startsAt:iso(Math.floor(now/1000)*1000-3*DAY),levels:LEVEL_QUOTAS.flatMap((count,i)=>Array(count).fill(i+1))});
 for(const row of db.prepare('SELECT id,kind,season_start FROM collect_inventories').all())registerCollection(db,{collectionId:row.id,kind:row.kind,seasonStartMs:row.season_start});
 for(const token of snapshot.tokens){
  if(token.id==='demo-att')continue;
  const activationMs=Date.parse(token.launchAt);
  importMarket(db,{id:token.id,symbol:token.symbol,ogSymbol:'SYNTHOG',attMint:qaAddress(seed,'att-'+token.id),ogMint:qaAddress(seed,'og-'+token.id),poolAddress:qaAddress(seed,'pool-'+token.id),activatedAt:token.launchAt});
  recordVaultManifest(db,{marketId:token.id,originalUnits:QA_SUPPLY,seasons:seasons.filter(s=>Date.parse(s.startsAt)<=activationMs)});
  seedFarm(db,{marketId:token.id,originalUnits:QA_SUPPLY,treasuryFeeBps:0});
  observeFarm(db,{id:'synthetic-deposit-'+token.id,marketId:token.id,kind:'deposit',at:token.launchAt,wallet,amount:String(BigInt(10000+activationMs%1000)*1000000n)},now);
  if(activationMs+2*DAY<now)observeFarm(db,{id:'synthetic-harvest-'+token.id,marketId:token.id,kind:'harvest',at:iso(activationMs+2*DAY),wallet},now);
  addCampaign(db,{tokenId:token.id,activationMs,originalUnits:QA_SUPPLY});
 }
 // Exercise actual submission, final review, cutoff and allocation helpers. No table edits bypass settlement.
 let finalized=0,awards=0;
 for(const token of snapshot.tokens){
  const at=Date.parse(token.launchAt)+60000,epoch=Math.floor(at/DAY),cutoff=(epoch+1)*DAY-1;
  if(cutoff>=now)continue;
  recordStakeRead(db,{wallet,tokenId:token.id,observedMs:at,expiresMs:at+300000,microUsd:'10000000',sourceRef:'synthetic-entry-'+token.id});
  const {submission}=submitContent(db,{wallet,tokenId:token.id,url:'https://example.invalid/synthetic-content/'+token.id,requestKey:'synthetic-submission-'+token.id,nowMs:at},{ids:{next:()=> 'synthetic-submission-'+token.id}});
  recordReview(db,{submissionId:submission.id,score:1+finalized%10,reason:'Synthetic QA review only; not an AI or moderator assessment.',moderator:'synthetic-qa-reviewer',sourceRef:'synthetic-review-'+token.id,reviewedMs:at+1000});
  recordStakeRead(db,{wallet,tokenId:token.id,observedMs:cutoff,expiresMs:cutoff+300000,microUsd:'10000000',sourceRef:'synthetic-cutoff-'+token.id});
  const assets=db.prepare('SELECT id,inventory_id,asset FROM collect_assets WHERE owner=? AND reveal_ms<=?').all(wallet,cutoff).map(a=>({assetId:a.id,collectionId:a.inventory_id,owner:wallet,chain:'solana',level:JSON.parse(a.asset).level}));
  recordOwnership(db,{wallet,epoch,asOfMs:cutoff,assets,sourceRef:'synthetic-owner-cutoff-'+epoch});
  const board=finalizeBoard(db,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'synthetic-complete-qa-'+epoch});
  if(board.status!=='final')throw Error('Synthetic board did not finalize: '+JSON.stringify(board));finalized++;
  const result=recordAllocation(db,{tokenId:token.id,day:2,nowMs:now});if(result.status==='recorded')awards++;
 }
 const pending=reserveMint(db,{inventoryId:demo.seasonId,stageId:'demo-priority',wallet,requestKey:'synthetic-qa-pending-mint',now});
 return {demo,largeHolder,markets:db.prepare('SELECT COUNT(*) n FROM market_fixtures').get().n,assets:db.prepare('SELECT COUNT(*) n FROM collect_assets').get().n,ownedAssets:db.prepare('SELECT COUNT(*) n FROM collect_assets WHERE owner=?').get(wallet).n,largeHolderAssets:db.prepare('SELECT COUNT(*) n FROM collect_assets WHERE owner=?').get(largeHolder).n,finalizedBoards:finalized,recordedAllocations:awards,submissions:db.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,pendingMintId:pending.operation.id};
}
