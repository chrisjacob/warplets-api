import assert from 'node:assert/strict';
import {configuredEconomicFixture,economicPrincipal,driveEconomics} from '../collect/legacy-economic-repository.fixtures.mjs';
import {createLegacyEconomicRepository} from '../collect/legacy-economic-repository.mjs';
import {createLegacyAdoptionPreparation} from '../collect/legacy-adoption-preparation.mjs';
import {createLegacyAdoptionActivation} from '../collect/legacy-adoption-activation.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
/** All parent audits, preparation and activation are actual commands. Optional
 * pinned beacon implementations are injected only by edge acceptance. */
export async function recoveryLegacyMintSource(t,options={}){
 if(!options.configured)return recoveryLegacyAdoptionSource(t,options);
 const f=await configuredEconomicFixture(t,{...options,prepareParent:false});
 if(options.beaconVerifier){f.economicPorts.beaconVerifier=options.beaconVerifier;f.economics=createLegacyEconomicRepository(f.economicPorts);}
 for(const scope of ['collection-publication','collection-founder'])f.db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(economicPrincipal.id,scope);
 await f.prepareParents();assert.equal((await driveEconomics(f,await f.economics.start(economicPrincipal,f.economicInput))).kind,'economic-ready');
 const input={adoptionId:'synthetic-configured-recovery-adoption',economicAuditId:f.economicInput.auditId},prep=createLegacyAdoptionPreparation(f.economicPorts);let r=await prep.start(economicPrincipal,input);
 for(let n=0;n<10000&&['started','progress','replayed'].includes(r.kind);n++)r=await prep.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:r.revision});assert.equal(r.kind,'prepared',JSON.stringify(r));
 const now=f.economicPorts.clock.nowMs(),crypto=f.crypto,activation=createLegacyAdoptionActivation({...f.economicPorts,driver:{...f.driver,leaseNowSql:String(now)}});assert.equal((await activation.activate(economicPrincipal,{adoptionId:input.adoptionId,requestKey:'activate-configured-recovery'})).kind,'committed');
 const schema=await readInstalledRecoverySchema(crypto),v2Codec=createRecoveryV2Codec({crypto}),codec=createManifestCodec({crypto}),ports={...f.economicPorts,schema,v2Codec,codec},capture=createRecoveryV2Capture(ports);let captured=await capture.start({captureId:'synthetic-configured-adoption-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 return {...f,...ports,ports,now,captured,store:f.artifacts};
}
