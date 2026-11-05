// Local synthetic fixtures only; no network, source-provider or financial work.
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {prepareArtifact,verifiedBytes} from '../artifacts/identity.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {createRecoveryExporter} from './export.mjs';
export function memoryArtifacts(){
 const objects=new Map();return {objects,async putIfAbsent(identity,input){const {bytes}=await prepareArtifact(identity,input),exists=objects.has(identity.key);if(!exists)objects.set(identity.key,bytes);
  const result=await verifiedBytes(identity,objects.get(identity.key));if(result.status!=='verified')throw Error('Synthetic immutable object conflict');return {status:exists?'exists':'created'};},
  async getVerified(identity){return objects.has(identity.key)?verifiedBytes(identity,objects.get(identity.key)):{status:'missing',identity};}};
}
export async function recoveryFixture(){
 const db=openDatabase(),crypto=createNodeCrypto(),store=memoryArtifacts(),codec=createManifestCodec({crypto}),driver=createNodeAtomicDriver(db);
 const golden=await buildGoldenScenario(db),schema=await readInstalledRecoverySchema(crypto),nowMs=Date.now();
 // The codec independently canonicalizes public bytes and preserves every
 // historic semantic digest from the pre-existing golden archive fixture.
 const artifact=await codec.build({board:golden.bundle.manifest.board,allocations:golden.bundle.manifest.allocations});
 await store.putIfAbsent(artifact.identity,artifact.bytes);
 db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').run(artifact.byteDigest,artifact.identity.key,artifact.bytes.length,'earn-archive-v1',nowMs);
 const ports={crypto,codec,clock:{nowMs:()=>Date.now()},ids:{next:randomUUID},schema};
 const exporter=createRecoveryExporter({...ports,driver,artifacts:store,sourceCommit:'0'.repeat(40)});
 return {db,driver,store,objects:store.objects,artifact,golden,...ports,exporter};
}
