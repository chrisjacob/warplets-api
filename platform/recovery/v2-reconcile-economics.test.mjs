import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {buildGoldenScenario} from '../application/fixtures/earn-scenario.mjs';
import {governanceWallets} from '../governance/operator-test-fixture.mjs';
import {recordAllocation} from '../earn/workflow.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2Reconciler} from './v2-reconcile.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
test('32 allocations by100 winners reconcile one projected allocation per bounded economic continuation',async t=>{
 const db=openDatabase();t.after(()=>db.close());const crypto=createNodeCrypto(),golden=await buildGoldenScenario(db,{wallets:['w1','w2','w3',...governanceWallets(97)]});
 // Exercise the archive codec's32-allocation ceiling with explicit synthetic
 // retained SQL. Normal campaign admission still enforces ten active campaigns.
 for(let n=1;n<32;n++){const tokenId=String(n).padStart(3,'0')+'t'.repeat(125);db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,golden.start,'18446744073709551600');recordAllocation(db,{tokenId,day:2,nowMs:golden.start+86400000});}
 assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_awards').get().n,3200);const base=createNodeAtomicDriver(db),realCodec=createManifestCodec({crypto}),v2Codec=createRecoveryV2Codec({crypto}),measurements=[],checks=[];let current=null,c={phase:'reconcile-economics',boardCursor:-9007199254740991,checkedBoards:0,targetWatermark:db.prepare('SELECT revision FROM app_recovery_watermark').get().revision};
 const driver={...base,async batch(statements){const result=await base.batch(statements);current.sql+=statements.length;current.returnedBytes+=Buffer.byteLength(JSON.stringify(result));current.maxRows=Math.max(current.maxRows,...result.map(r=>r.rows.length));return result;}},codec={...realCodec,async build(input){current.codecInputBytes+=utf8(canonicalJson(input)).length;const result=await realCodec.build(input);current.codecOutputBytes+=result.bytes.length;return result;}},repository={async advance(loaded,request){assert.equal(request.targetWatermark,c.targetWatermark);assert.equal(db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,c.targetWatermark);if(request.check)checks.push(request.check);c={...c,...request.delta};return {kind:'progress'};},async hold(loaded,reason){throw Error(reason);}},reconciler=createRecoveryV2Reconciler({driver,crypto,codec,v2Codec,artifacts:{},repository});
 // This isolates semantic/working-set behavior; actual mutation-fenced checks
 // and ready transitions are covered by the full private restore acceptance.
 for(let n=0;n<100&&c.phase==='reconcile-economics';n++){current={sql:0,returnedBytes:0,codecInputBytes:0,codecOutputBytes:0,maxRows:0};await reconciler.step({run:{id:'synthetic-economic-budget',checkpoint_json:JSON.stringify(c)},state:{generation:'synthetic'}});measurements.push(current);}
 assert.equal(c.phase,'reconcile-legacy-adoptions');assert.equal(checks.filter(check=>check.phase==='economics').length,32);assert.equal(checks.filter(check=>check.phase==='economics').reduce((sum,check)=>sum+check.itemCount,0),3200);assert.ok(measurements.every(m=>m.maxRows<=100&&m.sql<=4));const maxWorking=Math.max(...measurements.map(m=>m.returnedBytes+m.codecInputBytes+m.codecOutputBytes+131072));assert.ok(maxWorking<=1048576);t.diagnostic(JSON.stringify({allocations:32,winners:100,awardRows:3200,steps:measurements.length,maxReturnedRows:Math.max(...measurements.map(m=>m.maxRows)),maxSerializedWorkingBytesIncluding128KiBCheckpoint:maxWorking,largestCodecInputBytes:Math.max(...measurements.map(m=>m.codecInputBytes)),perAllocationConservation:true,storageAuthorityTest:false}));
});
