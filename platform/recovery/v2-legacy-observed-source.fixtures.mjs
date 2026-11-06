import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from '../collect/legacy-adoption-activation.fixtures.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from '../collect/observation-test-harness.mjs';
import {legacyAdmissionWallet} from '../collect/legacy-stage-source.fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
/** Genuine source audit/activation and genuine post-activation041 observations,
 * followed by full private capture. Original chain facts remain synthetic. */
export async function recoveryObservedAdoptionSource(t){
 const f=await preparedAdoptionFixture(t);assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'committed');
 for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(OBSERVATION_TEST_OPERATOR.id,scope);
 const before=f.db.prepare('SELECT * FROM collect_assets LIMIT 1').get(),at=f.economicPorts.clock.nowMs(),events=[{id:'reveal',kind:'reveal',observedMs:at+1000,from:null,to:null},{id:'transfer',kind:'transfer',observedMs:at+2000,from:before.owner,to:legacyAdmissionWallet(77)}],observations=[];let supersedes=null;
 for(const [index,event]of events.entries()){
  const evidence=await dispatchCollectionObservation({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:{method:'evidence',nowMs:at+3000,idPrefix:'observed-recovery-evidence-'+index,inventoryId:f.inventoryId,assetId:before.id,events,recordId:event.id,supersedes}});assert.equal(evidence.result?.kind,'committed',JSON.stringify(evidence));
  const input=observationInput(evidence.result.value,{requestKey:'observed-recovery-'+index,expectedAssetVersion:0}),result=await dispatchCollectionObservation({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:{nowMs:at+3000,idPrefix:'observed-recovery-apply-'+index,input}});assert.equal(result.result?.kind,'committed',JSON.stringify(result));supersedes=evidence.result.value.receiptDigest;observations.push({evidence:evidence.result.value,result:result.result.value});
 }
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(OBSERVATION_TEST_OPERATOR.id);f.db.exec('DELETE FROM app_evidence_heads');
 const now=at+10000,schema=await readInstalledRecoverySchema(f.crypto),v2Codec=createRecoveryV2Codec({crypto:f.crypto}),codec=createManifestCodec({crypto:f.crypto}),ports={...f.economicPorts,clock:{nowMs:()=>now},schema,v2Codec,codec},capture=createRecoveryV2Capture(ports);let captured=await capture.start({captureId:'synthetic-observed-adoption',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));return {...f,...ports,ports,now,captured,store:f.artifacts,observations,before};
}
