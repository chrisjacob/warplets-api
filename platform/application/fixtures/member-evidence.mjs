// Synthetic read-projection fixture. Sealed rows below are explicitly fixture
// inputs, not a second settlement implementation or real-chain evidence.
import {generateKeyPairSync,createHash} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {encode58} from '../../server/base58.mjs';
import {importMarket} from '../../markets/catalog.mjs';
import {observeAsset,recordVaultManifest} from '../../vault/ledger.mjs';
import {createCollection,publishCollectionStage,reserveMint,inspectOperation,fulfillMint} from '../../collect/store.mjs';
import {configureAction,recordActionCompletion} from '../../earn/components.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
const DAY=86400000,key=n=>encode58(Buffer.alloc(32,n)),iso=n=>new Date(n).toISOString();
const wallet=label=>{const pair=generateKeyPairSync('ed25519'),publicKeyBytes=[...pair.publicKey.export({type:'spki',format:'der'}).subarray(-32)];return {...pair,label,publicKeyBytes,wallet:encode58(new Uint8Array(publicKeyBytes))};};
export async function createMemberEvidenceFixture({nowMs=Math.floor(Date.now()/1000)*1000}={}){
 const db=openDatabase(),epoch=Math.floor(nowMs/DAY),accounts={minimum:wallet('minimum'),capped:wallet('capped'),bounded:wallet('bounded')};let server;
 try{
  const activation=nowMs-36*3600000,tokenId='member-evidence-att';
  importMarket(db,{id:tokenId,symbol:'SYNMEMBER',ogSymbol:'SYNOG',activatedAt:iso(activation),attMint:key(41),ogMint:key(42),poolAddress:key(43)});
  db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,activation,'402600000');
  configureWorkload(db,{effectiveEpoch:epoch,atMs:nowMs-1,staffedMinutes:30,secondsPerReview:60,admissionLimit:20,operator:'synthetic-member-reviewer',reason:'Synthetic member projection staffing'});
  recordSamplePrice(db,{wallet:accounts.minimum.wallet,tokenId,asOfMs:nowMs-1000,validUntilMs:nowMs+300000,stakedUnits:'10000000'});
  for(const [actionId,label] of [['synthetic-active-action','Synthetic active action'],['synthetic-rotated-action','Synthetic retired action']])
   configureAction(db,{actionId,label,verifier:'synthetic-attestor',enabled:true,effectiveEpoch:epoch-2,atMs:(epoch-3)*DAY});
  configureAction(db,{actionId:'synthetic-rotated-action',label:'Synthetic retired action',verifier:'synthetic-attestor',enabled:false,effectiveEpoch:epoch,atMs:(epoch-1)*DAY});
  for(const actionId of ['synthetic-active-action','synthetic-rotated-action'])recordActionCompletion(db,{wallet:accounts.capped.wallet,actionId,verifier:'synthetic-attestor',verifiedMs:(epoch-1)*DAY+1000,sourceRef:'synthetic-private-completion-'+actionId});
  for(const sealedEpoch of [epoch-2,epoch-1])db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(sealedEpoch,'[]',(sealedEpoch+1)*DAY,createHash('sha256').update('synthetic-member-board:'+sealedEpoch).digest('hex'),'synthetic-member-projection-board');
  const sealed=(account,sealedEpoch,{days=0,full=false,source})=>{
   const payload={intervals:full?Array.from({length:10},(_,n)=>({actionId:'synthetic-'+n,startEpoch:sealedEpoch})):[],
    completions:full?Array.from({length:10},(_,n)=>({actionId:'synthetic-'+n,verifiedAtMs:sealedEpoch*DAY})):[],highestEligibleLevel:full?10:0,purchaseTokenDays:full?99:0};
   db.prepare('INSERT INTO earn_member_facts VALUES(?,?,?,?)').run(sealedEpoch,account.wallet,JSON.stringify(payload),source);
   db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)').run(sealedEpoch,account.wallet,days,sealedEpoch*DAY+1000);
  };
  sealed(accounts.minimum,epoch-2,{days:10,full:true,source:'synthetic-earlier-streak'});
  sealed(accounts.minimum,epoch-1,{source:'synthetic-minimum-reset-components'});
  sealed(accounts.capped,epoch-1,{days:10,full:true,source:'synthetic-capped-components'});
  recordVaultManifest(db,{marketId:tokenId,originalUnits:'402600000'});
  for(const [name,count,offset] of [['minimum',26,0],['bounded',101,100]])for(let n=0;n<count;n++){
   const assetId='synthetic-'+name+'-'+String(n).padStart(3,'0');
   observeAsset(db,{eventId:'bind-'+assetId,assetId,kind:'bind',at:iso(nowMs-3600000),owner:accounts[name].wallet,slot:{kind:'genesis',tranche:1,level:1,ordinal:offset+n}},nowMs);
  }
  createCollection(db,{id:'synthetic-member-genesis',kind:'genesis',tranche:1});
  const stage={id:'synthetic-first',type:'whitelist',publishedAt:nowMs-3*DAY,opensAt:nowMs-DAY,closesAt:nowMs+DAY,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:[accounts.capped.wallet],walletLimit:1};
  publishCollectionStage(db,{inventoryId:'synthetic-member-genesis',stage},nowMs);
  const operation=reserveMint(db,{inventoryId:'synthetic-member-genesis',stageId:stage.id,wallet:accounts.capped.wallet,requestKey:'synthetic-hidden',now:nowMs-3600000}).operation;
  fulfillMint(db,{operationId:operation.id,assetId:'synthetic-concealed',commitment:inspectOperation(db,operation.id).commitment,proofId:'synthetic-hidden-proof',ticket:999,
   at:nowMs-1800000,traits:{model:'Synthetic concealed model',backdrop:'Synthetic concealed backdrop',symbol:'Synthetic concealed symbol'},finalized:true},nowMs);
  server=createLocalServer(createApp(db,{clock:()=>nowMs}));await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let closed=false;
  return {db,accounts,epoch,nowMs,tokenId,activation,origin:'http://127.0.0.1:'+server.address().port,async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}};
 }catch(error){server?.closeAllConnections();if(server?.listening)await new Promise(resolve=>server.close(resolve));db.close();throw error;}
}
