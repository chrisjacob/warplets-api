import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from '../collect/legacy-adoption-activation.fixtures.mjs';
import {dispatchImportedLifecycle} from '../collect/imported-lifecycle-test-harness.mjs';
import {MINT_FULFILLMENT_TEST_OPERATOR,mintFulfillmentInput} from '../collect/mint-fulfillment-test-harness.mjs';
import {createStagePublicationService} from '../collect/stage-service.mjs';
import {createStagePublicationRepository} from '../collect/stage-repository.mjs';
import {legacyAdmissionWallet,START,DAY} from '../collect/legacy-stage-source.fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
/** Genuine original audit/adoption followed by actual045, B04 and046 commands.
 * A final65proof is deliberately not produced by this source fixture. */
export async function recoveryImportedLifecycleSource(t,{pending=false}={}){
 const f=await preparedAdoptionFixture(t,{openAtActivation:true,paidWalletLimit:3,beforeParents(source){for(const scope of ['evidence-ingest','collection-evidence'])source.db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(MINT_FULFILLMENT_TEST_OPERATOR.id,scope);}});
 assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'committed');const now=START+30*DAY,terms=f.db.prepare('SELECT terms_digest,list_id FROM app_collection_stages').get(),principal={kind:'wallet',wallet:legacyAdmissionWallet(1)},request={method:'mint',nowMs:now,idPrefix:'synthetic-mixed-new',principal,input:{requestKey:'synthetic-mixed-mint',inventoryId:f.inventoryId,stageId:'paid',expectedTermsDigest:terms.terms_digest}},dispatch=r=>dispatchImportedLifecycle({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:r});
 const admission=await dispatch(request);assert.equal(admission.result.kind,'committed',JSON.stringify(admission));const op=f.db.prepare('SELECT * FROM collect_operations WHERE id=?').get(admission.result.value.operationId),event={inventoryId:f.inventoryId,operationId:op.id,kind:'mint',commitment:op.commitment,provenance:'manual-fixture',atMs:now+1000,proof:{proofId:'synthetic-mixed-proof',assetId:'synthetic-mixed-asset',ticket:900,traits:{model:'Synthetic mixed original',backdrop:'Sky',symbol:'Star'}}};
 const evidence=await dispatch({method:'fulfillment',fulfillment:{method:'evidence',event,nowMs:now+2000,idPrefix:'synthetic-mixed-evidence'}});assert.equal(evidence.result.kind,'committed',JSON.stringify(evidence));const fulfilled=await dispatch({method:'fulfillment',fulfillment:{nowMs:now+2000,idPrefix:'synthetic-mixed-fulfill',input:mintFulfillmentInput(evidence.result.value,'synthetic-mixed-complete')}});assert.equal(fulfilled.result.kind,'committed',JSON.stringify(fulfilled));
 if(pending){const accepted=await dispatch({...request,idPrefix:'synthetic-mixed-pending',input:{...request.input,requestKey:'synthetic-mixed-pending'}});assert.equal(accepted.result.kind,'committed',JSON.stringify(accepted));}
 const input={inventoryId:f.inventoryId,stageId:'synthetic-next-stage',type:'whitelist',publishedAt:now+3000,opensAt:START+42*DAY,closesAt:START+43*DAY,priceLamports:'100000000',costLamports:'5000',allocation:1,walletLimit:1,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:terms.list_id,sourceKind:'synthetic-local-operator-fixture'},stagePorts={...f.economicPorts,clock:{nowMs:()=>now+3000}};
 const publication=await createStagePublicationService({crypto:f.crypto,repository:createStagePublicationRepository({...f.driver,leaseNowSql:String(now+3000)},stagePorts)}).publishStage(adoptionPrincipal,{requestKey:'synthetic-mixed-new-stage',input});assert.equal(publication.kind,'committed',JSON.stringify(publication));
 const crypto=f.crypto,schema=await readInstalledRecoverySchema(crypto),ports={...f.economicPorts,clock:{nowMs:()=>now+4000},schema,v2Codec:createRecoveryV2Codec({crypto}),codec:createManifestCodec({crypto})},capture=createRecoveryV2Capture(ports);let captured=await capture.start({captureId:'synthetic-mixed-adoption-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 return {...f,...ports,ports,now:now+4000,captured,store:f.artifacts,modernOperationId:op.id,modernAssetId:event.proof.assetId,pending};
}
