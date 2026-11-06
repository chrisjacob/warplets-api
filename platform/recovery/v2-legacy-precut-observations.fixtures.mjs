import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from '../collect/legacy-adoption-activation.fixtures.mjs';
import {dispatchCollectionObservation,observationInput,OBSERVATION_TEST_OPERATOR} from '../collect/observation-test-harness.mjs';
import {observeCollectionAsset} from '../collect/store.mjs';
import {legacyAdmissionWallet} from '../collect/legacy-admission-audit.fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
/** Genuine historical mint, optional legacy prefix, accepted B04/041 prefix,
 * original audits/preparation/activation, and optional accepted041 suffix. */
export async function recoveryPrecutObservationSource(t,{legacyPrefix=true,later=true,interleave=false}={}){
 let events,assetId,seq=0,lastReceipt=null,scene;
 async function observe(f,event){
  const before=f.db.prepare('SELECT asset FROM collect_assets WHERE id=?').get(assetId),nowMs=event.observedMs+1000;
  const receipt=await dispatchCollectionObservation({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:{method:'evidence',nowMs,idPrefix:'precut-evidence-'+(++seq),inventoryId:f.inventoryId,assetId,events,recordId:event.id,supersedes:lastReceipt}});
  assert.equal(receipt.result?.kind,'committed',JSON.stringify(receipt));lastReceipt=receipt.result.value.receiptDigest;
  const accepted=await dispatchCollectionObservation({driver:f.driver,crypto:f.crypto,store:f.artifacts,request:{nowMs,idPrefix:'precut-observe-'+seq,input:observationInput(receipt.result.value,{requestKey:'precut-observe-'+seq,expectedAssetVersion:JSON.parse(before.asset).version})}});
  assert.equal(accepted.result?.kind,'committed',JSON.stringify(accepted));return accepted.result.value;
 }
 const f=await preparedAdoptionFixture(t,{beforeParents:async f=>{
  scene=f;for(const scope of ['evidence-ingest','collection-evidence'])f.db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(OBSERVATION_TEST_OPERATOR.id,scope);
  const a=f.db.prepare('SELECT * FROM collect_assets').get();assetId=a.id;const cut=f.economicPorts.clock.nowMs(),first=cut-10000,second=cut-5000,post=cut+5000;let owner=a.owner;
  if(legacyPrefix){const to=legacyAdmissionWallet(201);observeCollectionAsset(f.db,{sourceId:'synthetic-precut-legacy-prefix',assetId,kind:'transfer',from:owner,to,at:first-5000,finalized:true},first-5000);owner=to;}
  events=[{id:'pre-reveal',kind:'reveal',observedMs:first,from:null,to:null},{id:'pre-transfer',kind:'transfer',observedMs:second,from:interleave?legacyAdmissionWallet(203):owner,to:legacyAdmissionWallet(202)},{id:'post-transfer',kind:'transfer',observedMs:post,from:legacyAdmissionWallet(202),to:legacyAdmissionWallet(204)}];
  await observe(f,events[0]);
  if(interleave)observeCollectionAsset(f.db,{sourceId:'synthetic-precut-legacy-interleave',assetId,kind:'transfer',from:owner,to:legacyAdmissionWallet(203),at:first+2000,finalized:true},first+2000);
  await observe(f,events[1]);
 }});
 assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'committed');
 if(later)await observe(scene,events[2]);
 const now=f.economicPorts.clock.nowMs()+10000,crypto=f.crypto,schema=await readInstalledRecoverySchema(crypto),v2Codec=createRecoveryV2Codec({crypto}),codec=createManifestCodec({crypto}),ports={...f.economicPorts,clock:{nowMs:()=>now},schema,v2Codec,codec},capture=createRecoveryV2Capture(ports);let captured=await capture.start({captureId:'synthetic-precut-observation-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 return {...f,...ports,ports,now,captured,store:f.artifacts,assetId,events};
}
