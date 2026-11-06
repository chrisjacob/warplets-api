import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from '../collect/legacy-adoption-activation.fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
/** Genuine synthetic035→050→051→052→053→054, then independent private capture. */
export async function recoveryLegacyAdoptionSource(t,options={}){
 const f=await preparedAdoptionFixture(t,options);assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'committed');
 const now=f.economicPorts.clock.nowMs(),crypto=f.crypto,schema=await readInstalledRecoverySchema(crypto),v2Codec=createRecoveryV2Codec({crypto}),codec=createManifestCodec({crypto}),ports={...f.economicPorts,schema,v2Codec,codec},capture=createRecoveryV2Capture(ports);let captured=await capture.start({captureId:'synthetic-adoption-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 return {...f,...ports,ports,now,captured,store:f.artifacts};
}
