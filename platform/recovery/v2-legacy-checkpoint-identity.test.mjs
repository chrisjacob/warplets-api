import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson} from '../security/canonical.mjs';
import {packRecoveryV2Checkpoint,parseRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {createRecoveryV2LegacyMintReconciler} from './v2-reconcile-legacy-mints.mjs';
import {createRecoveryV2LegacyEconomicsReconciler} from './v2-reconcile-legacy-economics.mjs';
import {createRecoveryV2LegacyObjectReconciler} from './v2-reconcile-legacy-objects.mjs';
import {createRecoveryV2LegacyAggregateReconciler} from './v2-reconcile-legacy-aggregate.mjs';
import {verifyRecoveryImportedAuthority} from './v2-reconcile-imported-authority.mjs';

// Isolate the identity boundary: a sentinel proof reader prevents these minimal
// checkpoints from being mistaken for valid recovery or prerequisite evidence.
function fixture(phase){
 const checkpoint={phase,revision:1,targetWatermark:1,legacyAdoption:{id:'synthetic-identity'},descriptor:{schemaInventory:[{type:'table',name:'synthetic_table',sql:'CREATE TABLE synthetic_table (id TEXT PRIMARY KEY) STRICT'}]}};
 const loaded=value=>({run:{id:'synthetic-identity',checkpoint_json:canonicalJson(value)},state:{mode:'private',status:'restoring',active_restore_id:'synthetic-identity',write_nonce:null}});
 const altered=structuredClone(checkpoint);altered.descriptor.schemaInventory[0].sql='CREATE TABLE synthetic_table (id INTEGER PRIMARY KEY) STRICT';
 return {checkpoint,loaded,altered};
}
for(const [phase,factory] of [
 ['reconcile-legacy-adoption-mints',createRecoveryV2LegacyMintReconciler],
 ['reconcile-legacy-adoption-economics',createRecoveryV2LegacyEconomicsReconciler],
 ['reconcile-legacy-adoption-closure',createRecoveryV2LegacyObjectReconciler],
 ['reconcile-legacy-adoption-aggregate',createRecoveryV2LegacyAggregateReconciler],
])test(phase+' equates lossless encodings but refuses changed descriptor SQL before proof reads',async()=>{
 const f=fixture(phase);let reads=0;const helper=factory({driver:{async batch(){reads++;throw Error('synthetic proof reader reached');}},crypto:{},repository:{async hold(_loaded,reason){return {kind:'held',reason};}}});
 for(const storage of [f.checkpoint,packRecoveryV2Checkpoint(f.checkpoint)]){
  const loaded=f.loaded(storage),decoded=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json);reads=0;
  const valid=await helper.step(loaded,decoded);assert.equal(valid.kind,'held');assert.match(valid.reason,/synthetic proof reader reached/);assert.equal(reads,1);
  reads=0;const changed=await helper.step(loaded,f.altered);assert.equal(changed.kind,'held');assert.match(changed.reason,/checkpoint/);assert.equal(reads,0);
 }
});

test('imported authority compares exact decoded descriptors before reading historical proofs',async()=>{
 const f=fixture('reconcile-collection-authorities');let reads=0;const ports={driver:{async batch(){reads++;throw Error('synthetic proof reader reached');}},crypto:{}};
 for(const storage of [f.checkpoint,packRecoveryV2Checkpoint(f.checkpoint)]){
  const loaded=f.loaded(storage),authority={origin_kind:'verified-source-import'},c=parseRecoveryV2Checkpoint(loaded.run.checkpoint_json);reads=0;
  await assert.rejects(verifyRecoveryImportedAuthority({loaded,c,authority},ports),/synthetic proof reader reached/);assert.equal(reads,1);
  reads=0;await assert.rejects(verifyRecoveryImportedAuthority({loaded,c:f.altered,authority},ports),/private pinned target/);assert.equal(reads,0);
 }
});
