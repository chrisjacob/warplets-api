import {governanceOperatorFixture,governanceWallets} from '../governance/operator-test-fixture.mjs';
import {createCollection} from './store.mjs';
import {publishDrawPolicy} from '../randomness/selection.mjs';
import {createStagePublicationService} from './stage-service.mjs';
import {createStagePublicationRepository} from './stage-repository.mjs';
export const MINT_TEST_OPERATOR={kind:'operator',id:'synthetic-mint-operator'};
/** Node-only source setup; never imported by a production runtime. */
export async function mintFixture(t,{configured=false,large=false,type='whitelist',allocation=1000,index=true,admissionAtMs=null,kind='genesis'}={}){
 const f=await governanceOperatorFixture(t,{holders:governanceWallets(large?10000:4),nextWhitelist:[],index});
 if(admissionAtMs!==null)f.setNow(admissionAtMs-172800000);
 for(const scope of ['collection-publication','collection-founder'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_TEST_OPERATOR.id,scope);
 const inventoryId='synthetic-mint-fixture',publishedAt=f.getNow(),input={inventoryId,stageId:'synthetic-mint-stage',type,publishedAt,opensAt:publishedAt+172800000,closesAt:publishedAt+259200000,priceLamports:type==='founder'?'0':'100000000',costLamports:'500000',allocation,walletLimit:kind==='genesis'?null:2,founderApproved:type!=='whitelist',approvedSpendLamports:type==='founder'?'500000':null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:type==='public'?null:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture'};
 createCollection(f.db,{id:inventoryId,kind,...(kind==='genesis'?{tranche:1}:{seasonStart:publishedAt})});
 const assets=governanceWallets(1000),traitChoices=Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'Synthetic '+k+' one',weight:2},{name:'Synthetic '+k+' two',weight:1}]]));
 if(configured)publishDrawPolicy(f.db,{inventoryId,assets,traitChoices,at:publishedAt},publishedAt);
 const service=createStagePublicationService({...f.ports,repository:createStagePublicationRepository(f.base,f.ports)}),published=await service.publishStage(MINT_TEST_OPERATOR,{requestKey:'synthetic-mint-publication',input});
 if(published.kind!=='committed')throw Error(JSON.stringify(published));f.setNow(input.opensAt);
 return {...f,input,published,assets,traitChoices,principal:type==='founder'?MINT_TEST_OPERATOR:{kind:'wallet',wallet:f.holders[0]},request:{requestKey:'synthetic-mint-request',inventoryId,stageId:input.stageId,expectedTermsDigest:published.value.termsDigest,...(type==='founder'?{wallet:f.holders[0]}:{})}};
}
