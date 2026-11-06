import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRepositoryFixture,REFRESH_OWNER,REFRESH_OPERATOR} from '../nfts/refresh-repository.fixtures.mjs';
import {completeRefreshRehearsal} from '../nfts/refresh-acceptance.fixtures.mjs';
import {verifyRecoveredNftRefresh,nftRefreshCountsSql,createRecoveryV2NftRefreshReconciler} from './v2-reconcile-nft-refresh.mjs';
import {createRefreshWorkflow} from '../nfts/refresh-workflow.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const receipts=f=>f.db.prepare("SELECT * FROM app_command_receipts WHERE operation_kind='nfts.refresh.v1' ORDER BY rowid").all();
async function setup(t){const f=await refreshRepositoryFixture(t),done=await completeRefreshRehearsal(f),read=async s=>(await f.driver.batch(s)).map(v=>v.rows);return {...f,done,read};}
test('all seven actual refresh revisions independently verify exact original artifacts, receipt and predecessor after expiry/revocation',async t=>{
 const f=await setup(t),meter=[],ports={read:f.read,artifacts:f.store,crypto:f.crypto,onWorking:n=>meter.push(n)},original=[];
 for(const r of receipts(f))original.push(await verifyRecoveredNftRefresh(r,ports));
 f.setNow(f.clock.nowMs()+86400000);f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(REFRESH_OPERATOR.id);
 for(const [index,r]of receipts(f).entries())assert.deepEqual(await verifyRecoveredNftRefresh(r,ports),original[index]);
 const [counts]=await f.read([nftRefreshCountsSql()]);assert.deepEqual({...counts[0]},{receipts:7,revisions:7,revisionOrigins:7,checkpointOrigins:7,roots:1,predecessors:6});
 assert.ok(original.every(p=>p.metadataApplied===false&&p.rehearsalOnly&&p.financialExecution===false));assert.ok(Math.max(...meter)<1048576);t.diagnostic(JSON.stringify({verifiedRevisions:7,workingWithoutOuterCheckpoint:Math.max(...meter),historicalClock:true,grantsNotReauthorized:true}));
});
test('receipt, catalog, predecessor, event provenance, old private bytes and registration-time substitutions reject',async t=>{
 const f=await setup(t),all=receipts(f),ports={read:f.read,artifacts:f.store,crypto:f.crypto};
 for(const field of ['operation_id','principal_key','business_key','request_digest','expected_revisions','output_digest','result_ref'])await assert.rejects(verifyRecoveredNftRefresh({...all[3],[field]:'invalid'},ports));
 for(const mutate of [n=>n.prior_state_digest='f'.repeat(64),n=>n.artifact_operation='different',n=>n.request_digest='f'.repeat(64),n=>n.revision=2]){let once=false;await assert.rejects(verifyRecoveredNftRefresh(all[3],{...ports,read:async s=>{const rows=await f.read(s);if(!once&&s[0].sql.includes('FROM app_nft_refresh_revisions n')){once=true;mutate(rows[0][0]);}return rows;}}));}
 await assert.rejects(verifyRecoveredNftRefresh(all[3],{...ports,read:async s=>{const rows=await f.read(s);if(s[0].sql.includes('n.request_id=? AND n.revision=?'))rows[0]=[];return rows;}}),/predecessor/);
 for(const mode of ['late','input','digest'])await assert.rejects(verifyRecoveredNftRefresh(all[3],{...ports,read:async s=>{const rows=await f.read(s);if(s[0].sql.includes('FROM app_private_artifacts a JOIN app_command_receipts')){const row=rows[0][0];if(mode==='late'){row.recorded_ms=all[3].created_ms+1;row.receipt_created_ms=row.recorded_ms;}if(mode==='input')row.input_json='{}';if(mode==='digest')row.request_digest='f'.repeat(64);}return rows;}}));
 const media=f.store.objects.get(f.media.key);f.store.objects.delete(f.media.key);await assert.rejects(verifyRecoveredNftRefresh(all[6],ports),/evidence/);f.store.objects.set(f.media.key,media);
 await assert.rejects(verifyRecoveredNftRefresh(all[3],{...ports,artifacts:{async getVerified(identity){const got=await f.store.getVerified(identity);return got.status==='verified'?{...got,bytes:new Uint8Array(got.bytes.length)}:got;}}}),/digest/);
});
test('continuation budgets include outer checkpoint and object calls; missing durable proof/count prevents completion',async t=>{
 const f=await setup(t),measures=[],proofs=[],c={phase:'reconcile-nft-refresh',targetWatermark:String(f.db.prepare('SELECT revision FROM app_recovery_watermark WHERE id=1').get().revision),padding:'x'.repeat(90000)},loaded={run:{id:'synthetic-refresh-semantic'}};
 // This isolated controller verifies phase outputs only; full atomic persistence is exercised by normal V2 integration.
 const repository={async advance(_loaded,value){proofs.push(value.check);Object.assign(c,value.delta);return value;}};
 const reader={...f.driver,async batch(statements){const out=await f.driver.batch(statements);if(statements.some(s=>s.sql.includes('FROM app_recovery_reconcile_checks p')))out[1]={rows:[{n:proofs.length,items:proofs.length}]};return out;}};
 const reconcile=createRecoveryV2NftRefreshReconciler({driver:reader,artifacts:f.store,crypto:f.crypto,repository,onMeasure:m=>measures.push(m)});
 for(let n=0;n<7;n++){await reconcile.step(loaded,c);assert.equal(proofs[n].phase,'nft-refresh');assert.equal(proofs[n].targetWatermark,c.targetWatermark);}
 const missing=createRecoveryV2NftRefreshReconciler({driver:f.driver,artifacts:f.store,crypto:f.crypto,repository});await assert.rejects(missing.step(loaded,c),/coverage/);
 const before=c.checkedNftRefresh;c.checkedNftRefresh++;await assert.rejects(reconcile.step(loaded,c),/coverage/);c.checkedNftRefresh=before;
 await reconcile.step(loaded,c);assert.equal(c.nftRefreshComplete,true);assert.equal(c.phase,'reconcile-economics');assert.equal(proofs.at(-1).phase,'nft-refresh-count');assert.equal(proofs.at(-1).itemCount,7);
 assert.ok(measures.every(m=>m.operations<=56&&m.workingBytes<=1048576&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({maxOperations:Math.max(...measures.map(m=>m.operations)),maxObjectReads:Math.max(...measures.map(m=>m.objectReads)),maxWorkingBytes:Math.max(...measures.map(m=>m.workingBytes)),checkpointPaddingBytes:90000}));
 await assert.rejects(reconcile.step(loaded,{...c,padding:'x'.repeat(131073)}),/checkpoint/);
});

test('individually valid rehashed checkpoint cannot replace a previously accepted history prefix',async t=>{
 const f=await setup(t),r=receipts(f)[3],original=JSON.parse(r.result_json),state=JSON.parse(new TextDecoder().decode(f.store.objects.get(original.identity.key))),workflow=createRefreshWorkflow({crypto:f.crypto}),q=state.request;
 let fork=await workflow.create({requestId:q.requestId,metadata:state.metadata,owner:q.owner,expectedVersion:q.expectedVersion,referenceDigest:q.referenceDigest,quoteDigest:q.quoteDigest,createdMs:q.createdMs});
 for(const [index,h]of state.history.entries()){const e=structuredClone(h.event);if(index===0)e.eventId='different-retained-reference-event';fork=(await workflow.advance(fork,e,{...state.metadata,asset:{...state.metadata.asset,owner:h.context.owner,version:h.context.version},observedMs:h.context.observedMs})).state;}
 const raw=utf8(canonicalJson(fork)),digest=await f.crypto.sha256(raw),identity={...original.identity,key:'private/'+digest+'.json',byteDigest:digest,size:raw.length,semanticDigest:fork.stateDigest},result={...original,stateDigest:fork.stateDigest,identity},forged={...r,result_json:canonicalJson(result),result_ref:fork.stateDigest,output_digest:await f.crypto.sha256(utf8(canonicalJson(result)))};
 // Every supplied hash and the new checkpoint's internal replay are correct; only the immutable predecessor prefix exposes the fork.
 assert.deepEqual(await workflow.restore(fork),fork);let first=true;
 await assert.rejects(verifyRecoveredNftRefresh(forged,{crypto:f.crypto,artifacts:{async getVerified(i){return i.key===identity.key?{status:'verified',identity,bytes:raw}:f.store.getVerified(i);}},read:async s=>{const rows=await f.read(s);if(first&&s[0].sql.includes('FROM app_nft_refresh_revisions n')){first=false;Object.assign(rows[0][0],{state_digest:fork.stateDigest,object_key:identity.key,byte_digest:digest,size:raw.length,semantic_digest:fork.stateDigest});}return rows;}}),/history prefix/);
});
