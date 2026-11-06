import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryMintFixture} from './v2-mint-fixture.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2CaptureSource} from './v2-capture-source.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
async function ports(f){return {...f.ports,clock:{nowMs:()=>f.atMs+86400000},schema:await readInstalledRecoverySchema(f.ports.crypto),v2Codec:createRecoveryV2Codec(f.ports),codec:createManifestCodec(f.ports),beaconVerifier:f.beaconVerifier};}
test('source changes between fragments hold without freezing writes; lost fragment acknowledgement and orphan objects reconcile',async t=>{
 const f=await recoveryMintFixture(t,{configured:true,largeTraits:true}),p=await ports(f);let injected=false,mode='source-change';
 const driver={...f.base,async batch(statements){const fragment=statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_pages')&&String(s.values[1]).startsWith('fragments:'));if(fragment&&!injected&&mode==='source-change'){injected=true;f.db.exec("UPDATE app_revisions SET revision=revision+1 WHERE name='source'");}const result=await f.base.batch(statements);if(fragment&&!injected&&mode==='lost-ack'){injected=true;throw Error('Synthetic lost fragment capture acknowledgement.');}return result;}},service=createRecoveryV2CaptureSource({...p,driver,artifacts:f.store});
 const drive=async captureId=>{let r=await service.start({captureId,sourceCommit:'a'.repeat(40)});for(let n=0;n<500&&r.phase==='reading';n++)r=await service.step({captureId,expectedRevision:r.revision});return r;};
 const held=await drive('synthetic-fragment-source-changed');assert.equal(held.kind,'held');assert.equal(held.reason,'capture-source-changed');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM app_recovery_capture_pages WHERE capture_id=? AND scope LIKE 'fragments:%'").get(held.captureId).n,0);assert.equal(f.db.prepare('SELECT status FROM app_recovery_state').get().status,'live');
 mode='lost-ack';injected=false;const replayed=await drive('synthetic-fragment-source-restart');assert.equal(replayed.phase,'verifying',JSON.stringify(replayed));assert.equal(injected,true);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM app_recovery_capture_pages WHERE capture_id=? AND scope LIKE 'fragments:%'").get(replayed.captureId).n,16);
});
test('omitted chunk, assembled row and proof roll back; accepted chunk/row acknowledgements replay exactly once',async t=>{
 const f=await recoveryMintFixture(t,{configured:true,largeTraits:true}),p=await ports(f),capture=createRecoveryV2Capture({...p,driver:f.base,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-fragment-faults',sourceCommit:'a'.repeat(40)});for(let n=0;n<5000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured');
 const faults=['omit-fragment','lost-fragment-ack','omit-fragment-row','lost-fragment-row-ack','omit-fragment-check'],target=v2RestoreTarget(t,{...p,store:f.store,captured,now:p.clock.nowMs()},{faults});let result=await target.drive();assert.equal(result.kind,'conflict');assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_recovery_row_fragments').get().n,0);assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');
 result=await target.drive({resume:true});assert.equal(result.kind,'conflict');assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_recovery_row_fragments').get().n,16);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM fair_inventories').get().n,0);assert.throws(()=>target.db.prepare("UPDATE app_recovery_row_fragments SET text='bad'").run(),/immutable/);
 result=await target.drive({resume:true});assert.equal(result.kind,'conflict');assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='table-fragments'").get().n,0);result=await target.drive({resume:true});assert.equal(result.kind,'restored',JSON.stringify(result));assert.deepEqual([...target.injected].sort(),faults.sort());assert.equal(target.db.prepare('SELECT COUNT(*) n FROM fair_inventories').get().n,1);assert.equal(target.db.prepare('SELECT COUNT(*) n FROM app_recovery_row_fragments').get().n,16);assert.equal(target.db.prepare('SELECT write_nonce FROM app_recovery_state').get().write_nonce,null);
 t.diagnostic(JSON.stringify({fragmentFaults:5,exactOnceChunks:16,exactOnceRows:1,readyOnlyAfterProof:true,syntheticVerifier:true}));
});
