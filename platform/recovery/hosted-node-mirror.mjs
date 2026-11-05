// Cross-runtime comparison helper for B20. This mirrors the actual source via
// the checked private-recovery pipeline; it never invents settlement fixtures.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {prepareArtifact,verifiedBytes} from '../artifacts/identity.mjs';
import {createLocalSettlementContext} from '../application/settlement-context.mjs';
import {createPrivateRecovery} from './restore.mjs';
import {verifyPinnedInventory} from './inventory.mjs';

export async function createHostedNodeMirror({source,schema,sourceCommit,nowMs,principal}){
 assert.ok(Number.isSafeInteger(nowMs)&&nowMs>=0);assert.equal(principal.kind,'operator');
 const captured=await source.call({method:'recovery-capture',mode:'private',schema,sourceCommit});
 assert.equal(captured.kind,'captured',JSON.stringify(captured));
 const crypto=createNodeCrypto(),codec=createManifestCodec({crypto});
 const input={inventory:captured.inventory,pinnedDigest:captured.digest};
 await verifyPinnedInventory(input.inventory,input.pinnedDigest,crypto);
 const objects=new Map(),artifacts={
  async getVerified(identity){return objects.has(identity.key)?verifiedBytes(identity,objects.get(identity.key)):{status:'missing',identity};},
  async putIfAbsent(identity,input){const {bytes}=await prepareArtifact(identity,input),exists=objects.has(identity.key);
   if(!exists)objects.set(identity.key,bytes);const verified=await verifiedBytes(identity,objects.get(identity.key));
   if(verified.status!=='verified')return {status:'unknown',identity};return {status:exists?'exists':'created',identity};}
 };
 for(const identity of input.inventory.objects){const object=await source.bucket.get(identity.key);assert.ok(object,'Missing actual hosted object '+identity.key);
  assert.equal(object.size,identity.size);assert.equal(object.httpMetadata?.contentType,identity.contentType);
  const result=await artifacts.putIfAbsent(identity,new Uint8Array(await object.arrayBuffer()));assert.equal(result.status,'created');}
 const db=openDatabase();
 try{
  // A registered SQL function keeps lease CAS time aligned with the controllable
  // Node clock. Recovery intentionally revokes auth and fences acquired leases.
  db.function('hosted_fixture_now',()=>nowMs);
  const driver={...createNodeAtomicDriver(db),leaseNowSql:'hosted_fixture_now()'},clock={nowMs:()=>nowMs},ids={next:randomUUID};
  const restored=await createPrivateRecovery({driver,artifacts,crypto,codec,clock,ids,schema}).restore(input);
  assert.equal(restored.kind,'restored',JSON.stringify(restored));
  const context=createLocalSettlementContext({driver,artifacts,crypto,clock,ids,principal});
  return {db,context,artifacts,crypto,clock,ids,driver,inventoryDigest:input.pinnedDigest,recoveryReport:restored.report,
   setNow(value){assert.ok(Number.isSafeInteger(value)&&value>=0);nowMs=value;},close(){db.close();}};
 }catch(error){db.close();throw error;}
}
