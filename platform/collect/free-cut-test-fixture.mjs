import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createCollection,publishCollectionStage,reserveMint,fulfillMint,inspectOperation,observeCollectionAsset} from './store.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
import {createCollectionCutService} from './free-cut-service.mjs';
import {createCollectionCutRepository} from './free-cut-repository.mjs';
import {encodeCollectionCut} from './free-cut-codec.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
export const CUT_OPERATOR={kind:'operator',id:'synthetic-cut-operator'};
/** Node-only setup. Retained Genesis bindings and the output list are genuine
 * local fixture records; no arbitrary chain-coverage authority is supplied. */
export async function freeCutFixture(t,{count=2,trackedCount=count,wrap=base=>base}={}){
 const f=await governanceOperatorFixture(t,{holders:governanceWallets(count),nextWhitelist:[],index:true});
 for(const scope of ['collection-publication','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(CUT_OPERATOR.id,scope);
 const start=Math.floor(f.getNow()/1000)*1000,day=86400000,genesisId='synthetic-cut-genesis',inventoryId='synthetic-cut-season',stageId='synthetic-cut-free';createCollection(f.db,{id:genesisId,kind:'genesis',tranche:1});
 publishCollectionStage(f.db,{inventoryId:genesisId,stage:{id:'synthetic-seed',type:'whitelist',publishedAt:start-4*day,opensAt:start-2*day,closesAt:start-day,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets:f.holders,walletLimit:1}},start);
 const holdings=[];for(let n=0;n<trackedCount;n++){
  const assetId='synthetic-cut-genesis-'+String(n).padStart(5,'0'),at=start-2*day+1000*n,{operation}=reserveMint(f.db,{inventoryId:genesisId,stageId:'synthetic-seed',wallet:f.holders[n],requestKey:assetId,now:at});
  fulfillMint(f.db,{operationId:operation.id,assetId,commitment:inspectOperation(f.db,operation.id).commitment,proofId:'synthetic-cut-proof-'+n,ticket:0,traits:{model:'Synthetic',backdrop:'Synthetic',symbol:'Synthetic'},at:at+1000,finalized:true},start);
  observeCollectionAsset(f.db,{sourceId:'synthetic-cut-reveal-'+n,assetId,kind:'reveal',at:at+2000,finalized:true},start);
  holdings.push({id:assetId,owner:f.holders[n],collection:'solana-genesis',level:1,revealedAt:at+2000});
 }
 createCollection(f.db,{id:inventoryId,kind:'season',seasonStart:start});const publisher=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)}),base={inventoryId,type:'whitelist',publishedAt:start,priceLamports:'100000000',costLamports:'5000',allocation:1000,walletLimit:2,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 for(const [n,days] of [[0,2],[1,3]]){const r=await publisher.publishStage(CUT_OPERATOR,{requestKey:'synthetic-paid-'+n,input:{...base,stageId:'synthetic-paid-'+n,opensAt:start+days*day,closesAt:start+(days+1)*day}});if(r.kind!=='committed')throw Error(JSON.stringify(r));}
 for(let n=trackedCount;n<count;n++)holdings.push({id:'z'.repeat(110)+String(n).padStart(5,'0'),owner:f.holders[n],collection:'solana-genesis',level:1,revealedAt:start});
 const cutMs=start+5*day,publication=await publisher.publishStage(CUT_OPERATOR,{requestKey:stageId,input:{...base,stageId,type:'free',opensAt:cutMs,closesAt:cutMs+day,priceLamports:'0',walletLimit:null,eligibilityListId:null}});if(publication.kind!=='committed')throw Error(JSON.stringify(publication));f.setNow(cutMs);
 const bundle=await encodeCollectionCut({inventoryId,stageId,termsDigest:publication.value.termsDigest,atMs:cutMs,sourceRef:'synthetic-fixed-opening-cut',eligibilityListId:f.groups[0].manifest.id,holdings},f.ports.crypto),measurements=[],driver=wrap({...f.base,async batch(statements){const measured=measureBatch(statements),result=await f.base.batch(statements);measurements.push({...measured,resultBytes:new TextEncoder().encode(JSON.stringify(result)).length});return result;}},f),service=createCollectionCutService({...f.ports,repository:createCollectionCutRepository(driver,f.ports)});
 const stage=async()=>{for(const record of [...bundle.pages,bundle.root]){const r=await service.stageRecord(CUT_OPERATOR,{requestKey:record.id,record});if(!['committed','replayed'].includes(r.kind))throw Error(JSON.stringify(r));}};
 return {...f,bundle,holdings,publication,cutMs,inventoryId,stageId,service,driver,measurements,stage,begin:(key='synthetic-cut-begin')=>service.beginCut(CUT_OPERATOR,{requestKey:key,rootId:bundle.root.id}),page:(attemptId,pageIndex=0,key='synthetic-cut-page-'+pageIndex)=>service.validatePage(CUT_OPERATOR,{requestKey:key,attemptId,pageIndex}),seal:(attemptId,key='synthetic-cut-seal')=>service.sealCut(CUT_OPERATOR,{requestKey:key,attemptId})};
}
