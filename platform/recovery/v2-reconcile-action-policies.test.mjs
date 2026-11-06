import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {buildActionPolicyCommand} from '../earn/action-policy-service.mjs';
import {createActionPolicyRepository} from '../earn/action-policy-repository.mjs';
import {verifyRecoveredActionPolicy} from './v2-reconcile-action-policies.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {memoryArtifacts} from './fixtures.mjs';
async function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const now=20001*86400000+123,crypto=createNodeCrypto(),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>now}},base={...createNodeAtomicDriver(db),leaseNowSql:String(now)},principal={kind:'operator',id:'synthetic-action-recovery'};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'earn-action-policy');
 const command=await buildActionPolicyCommand({principal,requestKey:'synthetic-action-policy',input:{actionId:'synthetic-learn',label:'Synthetic guide',verifier:'synthetic-verifier',effectiveEpoch:20002,enabled:true,evidenceRef:'synthetic-local-evidence'},nowMs:now,expectedRevisions:Object.fromEntries(db.prepare('SELECT * FROM app_revisions').all().map(r=>[r.name,String(r.revision)]))},crypto);
 assert.equal((await createActionPolicyRepository(base,ports).configureAction(command)).kind,'committed');
 return {db,base,ports,now,command,receipt:db.prepare("SELECT * FROM app_command_receipts WHERE operation_kind='earn.configure-action.v1'").get(),read:async statements=>(await base.batch(statements)).map(r=>r.rows)};
}
test('historical policy recovery verifies receipt, immutable definition and exact audit without present-time predicates',async t=>{
 const f=await fixture(t);assert.equal((await verifyRecoveredActionPolicy(f.receipt,f.read,f.ports.crypto)).businessIdentity,f.command.businessIdentity);
 for(const field of ['request_digest','output_digest','business_key','principal_key','result_json']){const bad={...f.receipt,[field]:field==='result_json'?'{}':'corrupt'};await assert.rejects(verifyRecoveredActionPolicy(bad,f.read,f.ports.crypto));}
 for(const mutate of [rows=>rows[0][0].label='altered',rows=>rows[1].pop(),rows=>rows[1][0].event_hash='f'.repeat(64)])await assert.rejects(verifyRecoveredActionPolicy(f.receipt,async statements=>{const rows=await f.read(statements);mutate(rows);return rows;},f.ports.crypto));
 const envelope=JSON.parse(f.receipt.input_json);delete envelope.audit;await assert.rejects(verifyRecoveredActionPolicy({...f.receipt,input_json:JSON.stringify(envelope)},f.read,f.ports.crypto));
});
test('fresh private restore includes action policy semantic check before readiness and preserves replay',async t=>{
 const f=await fixture(t),now=f.now+10*86400000,store=memoryArtifacts(),ports={...f.ports,clock:{nowMs:()=>now},schema:await readInstalledRecoverySchema(f.ports.crypto),v2Codec:createRecoveryV2Codec(f.ports),codec:createManifestCodec(f.ports)};
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();const capture=createRecoveryV2Capture({...ports,driver:f.base,artifacts:store});let captured=await capture.start({captureId:'synthetic-action-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<3000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));
 const target=v2RestoreTarget(t,{...ports,store,captured,now}),result=await target.drive();assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(target.db.prepare("SELECT COUNT(*) n FROM app_recovery_reconcile_checks WHERE phase='action-policy'").get().n,1);
 assert.deepEqual(target.db.prepare('SELECT * FROM earn_action_changes').all(),f.db.prepare('SELECT * FROM earn_action_changes').all());assert.equal((await createActionPolicyRepository(target.driver,ports).configureAction(f.command)).kind,'replayed');assert.ok(target.metrics.every(m=>m.sql<=64&&m.maxBatchBytes<=262144));
 t.diagnostic(JSON.stringify({tables:result.report.tables,steps:target.metrics.length,maxSql:Math.max(...target.metrics.map(m=>m.sql)),maxBatchBytes:Math.max(...target.metrics.map(m=>m.maxBatchBytes)),financialExecution:result.report.financialExecution}));
});
