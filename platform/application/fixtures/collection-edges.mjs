// Explicit synthetic ownership/reveal transcripts and local draw outcomes only.
import {generateKeyPairSync} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {encode58} from '../../server/base58.mjs';
import {createCollection,publishCollectionStage,reserveMint,fulfillMint,inspectOperation,observeCollectionAsset,freezeSeasonSnapshot} from '../../collect/store.mjs';
import {createGuardedFulfillmentFixture} from './guarded-fulfillment.mjs';
import {importMarket} from '../../markets/catalog.mjs';
import {recordVaultManifest,observeAsset} from '../../vault/ledger.mjs';
import {LEVEL_QUOTAS} from '../../domain/collections/policy.mjs';
const DAY=86400000,iso=ms=>new Date(ms).toISOString(),key=n=>encode58(Buffer.alloc(32,n));
const account=label=>{const pair=generateKeyPairSync('ed25519'),bytes=pair.publicKey.export({type:'spki',format:'der'}).subarray(-32);return {...pair,label,wallet:encode58(bytes),publicKeyBytes:[...bytes]};};
export async function createCollectionEdgeFixture({assetCount=101,seasonLevel=1,nowMs=Math.floor(Date.now()/1000)*1000,startServer=true}={}){
 if(!Number.isInteger(seasonLevel)||seasonLevel<1||seasonLevel>9||!Number.isInteger(assetCount)||assetCount<2||assetCount>LEVEL_QUOTAS[seasonLevel-1])throw Error('Invalid synthetic Season pair inventory.');
 const db=openDatabase(),accounts=Object.fromEntries(['original','buyer','late','seasonOnly'].map(label=>[label,account(label)]));let server;
 const seasonId='synthetic-edge-season',start=nowMs-40*DAY,cut=nowMs-3600000,genesisOpen=start-2*DAY;
 const traits={model:'Synthetic ink',backdrop:'Synthetic sky',symbol:'Synthetic star'};
 const mint=(inventoryId,stageId,owner,id,at,reveal=true,ticket=0)=>{
  const {operation}=reserveMint(db,{inventoryId,stageId,wallet:owner,requestKey:'seed-'+id,now:at});
  fulfillMint(db,{operationId:operation.id,assetId:id,commitment:inspectOperation(db,operation.id).commitment,proofId:'synthetic-proof-'+id,ticket,traits,at:at+1000,finalized:true},nowMs);
  if(reveal)observeCollectionAsset(db,{sourceId:'synthetic-reveal-'+id,assetId:id,kind:'reveal',at:at+2000,finalized:true},nowMs);
 };
 try{
  createCollection(db,{id:'synthetic-edge-genesis',kind:'genesis',tranche:1});
  publishCollectionStage(db,{inventoryId:'synthetic-edge-genesis',stage:{id:'synthetic-genesis-first',type:'whitelist',publishedAt:genesisOpen-2*DAY,opensAt:genesisOpen,closesAt:start,
   allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[accounts.original.wallet,accounts.late.wallet],walletLimit:1}},nowMs);
  mint('synthetic-edge-genesis','synthetic-genesis-first',accounts.original.wallet,'synthetic-genesis-before',genesisOpen+1000);
  mint('synthetic-edge-genesis','synthetic-genesis-first',accounts.late.wallet,'synthetic-genesis-late',genesisOpen+4000,false);
  createCollection(db,{id:seasonId,kind:'season',seasonStart:start});
  const base={type:'whitelist',publishedAt:start,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[accounts.original.wallet,accounts.seasonOnly.wallet],walletLimit:assetCount};
  for(const stage of [{...base,id:'synthetic-priority',opensAt:start,closesAt:start+DAY},{...base,id:'synthetic-expanded',opensAt:start+DAY,closesAt:cut},
   {...base,id:'synthetic-free',type:'free',priceLamports:'0',opensAt:cut,closesAt:nowMs+DAY}])publishCollectionStage(db,{inventoryId:seasonId,stage},nowMs);
  const ticket=LEVEL_QUOTAS.slice(0,seasonLevel-1).reduce((sum,n)=>sum+n,0);
  for(let n=0;n<assetCount;n++)mint(seasonId,'synthetic-priority',accounts.original.wallet,'synthetic-season-'+String(n).padStart(3,'0'),start+1000+n*3000,true,ticket);
  mint(seasonId,'synthetic-priority',accounts.seasonOnly.wallet,'synthetic-season-only',start+1000+assetCount*3000);
  observeCollectionAsset(db,{sourceId:'synthetic-transfer-after-cut',assetId:'synthetic-genesis-before',kind:'transfer',from:accounts.original.wallet,to:accounts.buyer.wallet,at:cut+1000,finalized:true},nowMs);
  observeCollectionAsset(db,{sourceId:'synthetic-reveal-after-cut',assetId:'synthetic-genesis-late',kind:'reveal',at:cut+2000,finalized:true},nowMs);
  const snapshot={inventoryId:seasonId,stageId:'synthetic-free',sourceRef:'synthetic-fixed-opening-complete-cut',at:cut,finalized:true,holdings:[
   {id:'synthetic-genesis-before',owner:accounts.original.wallet,collection:'solana-genesis',revealedAt:genesisOpen+3000,level:1},
   {id:'synthetic-genesis-late',owner:accounts.late.wallet,collection:'solana-genesis',revealedAt:null,level:null},
   {id:'synthetic-season-only',owner:accounts.seasonOnly.wallet,collection:'solana-season',revealedAt:start+3000+assetCount*3000,level:1},
  ]};
  const tokenId='synthetic-edge-att',activation=start+DAY;
  importMarket(db,{id:tokenId,symbol:'SYNEDGE',ogSymbol:'SYNOG',attMint:key(51),ogMint:key(52),poolAddress:key(53),activatedAt:iso(activation)});
  recordVaultManifest(db,{marketId:tokenId,originalUnits:'402600000',seasons:[{id:seasonId,startsAt:iso(start),levels:LEVEL_QUOTAS.flatMap((count,n)=>Array(count).fill(n+1))}]});
  observeAsset(db,{eventId:'synthetic-historical-claim',assetId:'synthetic-season-000',kind:'claim',at:iso(nowMs-7200000),owner:accounts.original.wallet,marketId:tokenId,units:'1'},nowMs);
  const historical=()=>JSON.stringify({manifests:db.prepare('SELECT * FROM vault_manifests ORDER BY id').all(),claims:db.prepare('SELECT * FROM vault_claim_totals ORDER BY asset_id,launch_id').all()});
  const fulfill=createGuardedFulfillmentFixture(db);
  if(startServer){server=createLocalServer(createApp(db,{clock:()=>nowMs}));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}let closed=false;
  return {db,accounts,seasonId,start,cut,nowMs,tokenId,activation,snapshot,traits,origin:server?'http://127.0.0.1:'+server.address().port:null,historical,
   acceptSnapshot:(value=snapshot)=>freezeSeasonSnapshot(db,value,nowMs),
   fulfill:(operationId,extra={ticket:0})=>fulfill(operationId,{atMs:nowMs,...extra},nowMs),
   async close(){if(closed)return;closed=true;if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}db.close();}};
 }catch(error){server?.closeAllConnections();if(server?.listening)await new Promise(resolve=>server.close(resolve));db.close();throw error;}
}
