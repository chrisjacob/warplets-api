import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
import {recordSamplePrice} from '../pricing/fixtures.mjs';
import {registerPosition,recordPositionEvent,reconcilePosition} from './positions.mjs';
import {configureAction,recordActionCompletion,registerCollection,recordOwnership} from './components.mjs';
import {buildRequirementSpecs,selectRequirementReceipts} from '../evidence/requirements.mjs';
import {computeBoard} from './settlement.mjs';
const epoch=20,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
function buy(db,{sequence,atMs,signature}){
 recordPositionEvent(db,{wallet:'w',tokenId:'A',sequence,type:'verified-buy-and-stake',signature,instructionIndex:2,atMs,confirmed:true,sourceRef:'synthetic-linked-buy',
  swap:{wallet:'w',tokenId:'A',signature,instructionIndex:1,netBoughtUnits:'10000000'},
  deposit:{wallet:'w',tokenId:'A',signature,instructionIndex:2,depositedUnits:'10000000'}});
}
function multiwallet({db}){
 const activated=start-2*DAY_MS;db.prepare("UPDATE earn_fixture_campaigns SET activation_ms=? WHERE token_id='A'").run(activated);
 registerPosition(db,{wallet:'w',tokenId:'A',enrolledMs:activated});
 buy(db,{sequence:1,atMs:activated+1,signature:'synthetic-first-buy'});
 recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:start-DAY_MS-1,stakedUnits:'10000000'});
 reconcilePosition(db,{epoch:epoch-2,wallet:'w',tokenId:'A',asOfMs:start-DAY_MS-1,reconciledSequence:1,sourceRef:'synthetic-first-day'});
 recordPositionEvent(db,{wallet:'w',tokenId:'A',sequence:2,type:'withdrawal',signature:'synthetic-direct-withdrawal',instructionIndex:1,
  atMs:start-DAY_MS,confirmed:true,sourceRef:'synthetic-full-exit',withdrawnUnits:'10000000',remainingStakeUnits:'0'});
 buy(db,{sequence:3,atMs:start-DAY_MS+1,signature:'synthetic-repurchase'});
 recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:start-1,stakedUnits:'10000000'});
 reconcilePosition(db,{epoch:epoch-1,wallet:'w',tokenId:'A',asOfMs:start-1,reconciledSequence:3,sourceRef:'synthetic-reentry-day'});
 reconcilePosition(db,{epoch,wallet:'w',tokenId:'A',asOfMs:cutoff,reconciledSequence:3,sourceRef:'synthetic-current-day'});
 const entry=recordSamplePrice(db,{wallet:'w2',tokenId:'A',asOfMs:start,stakedUnits:'10000000',validUntilMs:start+100});
 db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('fixture-post-w2','w2','A',epoch,'https://example.test/post/w2',start+1,entry.receipt,'fixture-key-w2');
 db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('fixture-post-w2',7,'fixture-moderator','synthetic second review',start+3,'synthetic-review-w2');
 recordSamplePrice(db,{wallet:'w2',tokenId:'A',asOfMs:cutoff,stakedUnits:'10000000'});
 registerCollection(db,{collectionId:'synthetic-genesis',kind:'genesis'});
 recordOwnership(db,{wallet:'w',epoch,asOfMs:cutoff,assets:[],sourceRef:'synthetic-no-longer-owner'});
 recordOwnership(db,{wallet:'w2',epoch,asOfMs:cutoff,assets:[{assetId:'synthetic-transferred-nft',collectionId:'synthetic-genesis',owner:'w2',chain:'solana',level:4}],sourceRef:'synthetic-current-owner'});
 configureAction(db,{actionId:'synthetic-action',label:'Synthetic action',verifier:'synthetic-verifier',effectiveEpoch:epoch-1,enabled:true,atMs:start-2*DAY_MS});
 configureAction(db,{actionId:'synthetic-action',label:'Synthetic action',verifier:'synthetic-verifier',effectiveEpoch:epoch,enabled:true,atMs:start-DAY_MS});
 recordActionCompletion(db,{wallet:'w2',actionId:'synthetic-action',verifier:'synthetic-verifier',verifiedMs:start+5,sourceRef:'synthetic-action-completion'});
 const old=recordSamplePrice(db,{wallet:'late-only',tokenId:'A',asOfMs:start-DAY_MS,stakedUnits:'10000000',validUntilMs:start-DAY_MS+100});
 db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('synthetic-delayed-post','late-only','A',epoch-1,'https://example.test/delayed',start-DAY_MS+1,old.receipt,'synthetic-delayed-key');
 db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('synthetic-delayed-post',7,'fixture-moderator','synthetic delayed approval',start+10,'synthetic-delayed-review');
 for(const priorEpoch of [epoch-2,epoch-1])db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(priorEpoch,'[]',start,'synthetic-prior-'+priorEpoch,'synthetic-prior-board');
 db.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)').run('synthetic-delayed-post',epoch-1,1,old.receipt);
 db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)').run(epoch-1,'late-only',2,start-1);
}
async function selection(env,query=env.query){
 const inventory=await env.repository.loadInventory({...query,nowMs:env.clock.nowMs()});
 assert.equal(inventory.kind,'loaded',JSON.stringify(inventory));
 const specs=await buildRequirementSpecs(inventory.inputs,env.crypto),result=await selectRequirementReceipts(specs,await env.repository.selectHeads(specs),env.crypto);
 return {inventory,...result};
}
function rootAndInput(env,result){
 const row=env.db.prepare('SELECT object_key FROM app_snapshot_attempts WHERE manifest_digest=?').get(result.value.manifestDigest);
 const root=JSON.parse(new TextDecoder().decode(env.objects.get(row.object_key)));
 return {root,input:JSON.parse(new TextDecoder().decode(env.objects.get(root.inputObject.key)))};
}
test('multiwallet cutoff binds delayed streaks, ownership/action changes and a full withdrawal reset',async t=>{
 const env=await cutoffScenario({beforeFreeze:multiwallet,historyStartMs:start-2*DAY_MS});t.after(()=>env.db.close());
 const selected=await selection(env);assert.equal(selected.kind,'ready',JSON.stringify(selected.dependencies));
 assert.equal(selected.inventory.measurements.participants,2);
 const chain=selected.inventory.walletDetails.find(w=>w.wallet==='w').chains[0].chain;
 assert.equal(chain.status,'ready');assert.equal(chain.tokenDays,2);assert.deepEqual(chain.position.flags,[epoch-1,epoch]);
 assert.equal(chain.position.sequence,3);assert.equal(chain.position.creditedUnits,'10000000');
 const sealed=await env.service.assemble(env.principal,env.query);assert.equal(sealed.kind,'committed',JSON.stringify(sealed));
 const {root,input}=rootAndInput(env,sealed),plan=computeBoard(input);assert.equal(plan.status,'ready');assert.equal(plan.decisions.length,2);
 assert.equal(input.facts.w.components.highestEligibleLevel,0);assert.equal(input.facts.w2.components.highestEligibleLevel,4);
 assert.ok(input.facts.w2.components.actionTenths>0);assert.equal(input.facts.w.components.purchaseTokenDays,2);
 assert.equal(input.late.length,1);assert.equal(plan.streaks.find(s=>s.wallet==='late-only').days,3);
 assert.equal(root.mode,'synthetic-fixture');assert.equal(root.status,'ready');
 assert.equal((await env.service.assemble(env.principal,env.query)).value.manifestDigest,sealed.value.manifestDigest);
});
test('each external transcript is independently required without making unrelated facts pending',async t=>{
 const env=await cutoffScenario({beforeFreeze:multiwallet,historyStartMs:start-2*DAY_MS});t.after(()=>env.db.close());
 for(const binding of env.query.sourceBindings){
  const query={...env.query,sourceBindings:env.query.sourceBindings.filter(b=>b!==binding)},result=await selection(env,query);
  assert.equal(result.kind,'pending');assert.equal(result.dependencies.length,1,binding.kind+' '+binding.subject.id+' '+binding.cutoffMs);
  const held=result.requirements.find(r=>r.id===result.dependencies[0].id);
  assert.equal(held.kind,binding.kind);assert.deepEqual(held.subject,binding.subject);assert.equal(held.cutoffMs,binding.cutoffMs);
 }
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
});
test('missing intermediate daily checkpoint and price retain exact historical dependencies',async t=>{
 const env=await cutoffScenario({beforeFreeze:multiwallet,historyStartMs:start-2*DAY_MS});t.after(()=>env.db.close());
 const checkpoint=env.db.prepare('SELECT * FROM earn_position_cutoffs WHERE epoch=?').get(epoch-1);
 env.db.prepare('DELETE FROM earn_position_cutoffs WHERE epoch=?').run(epoch-1);
 const missing=await selection(env),chain=missing.inventory.walletDetails.find(w=>w.wallet==='w').chains[0].chain;
 assert.deepEqual(chain.dependencies,[{epoch:epoch-1,reason:'position-checkpoint-missing'}]);
 assert.deepEqual(missing.requirements.filter(r=>r.gaps.length).map(r=>r.kind).sort(),['position-checkpoints','position-history']);
 assert.equal((await env.service.assemble(env.principal,env.query)).reason,'snapshot-dependencies');
 env.db.prepare('INSERT INTO earn_position_cutoffs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(checkpoint));
 const binding=env.query.sourceBindings.find(b=>b.kind==='closing-stake'&&b.cutoffMs===start-1);
 const without={...env.query,sourceBindings:env.query.sourceBindings.filter(b=>b!==binding)},priced=await selection(env,without);
 assert.equal(priced.dependencies.length,1);assert.equal(priced.requirements.find(r=>r.gaps.length).cutoffMs,start-1);
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
});
test('missing ownership remains pending and becomes ready after exact evidence is restored',async t=>{
 const env=await cutoffScenario({beforeFreeze:multiwallet,historyStartMs:start-2*DAY_MS});t.after(()=>env.db.close());
 const owner=env.db.prepare("SELECT * FROM earn_owner_snapshots WHERE wallet='w2'").get(),assets=env.db.prepare("SELECT * FROM earn_owner_assets WHERE wallet='w2'").all();
 env.db.prepare("DELETE FROM earn_owner_assets WHERE wallet='w2'").run();env.db.prepare("DELETE FROM earn_owner_snapshots WHERE wallet='w2'").run();
 const held=await selection(env);assert.equal(held.dependencies.length,1);assert.equal(held.requirements.find(r=>r.gaps.length).kind,'ownership');
 const pending=await env.service.assemble(env.principal,env.query);assert.equal(pending.reason,'snapshot-dependencies');
 env.db.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(...Object.values(owner));
 for(const asset of assets)env.db.prepare('INSERT INTO earn_owner_assets VALUES(?,?,?)').run(...Object.values(asset));
 const ready=await env.service.assemble(env.principal,env.query);assert.equal(ready.kind,'committed');assert.notEqual(ready.value.manifestDigest,pending.manifestDigest);
});
test('positive empty bootstrap coverage seals an empty plan but an unresolved earlier board holds',async t=>{
 const empty=await cutoffScenario({post:false});t.after(()=>empty.db.close());
 const sealed=await empty.service.assemble(empty.principal,empty.query);assert.equal(sealed.kind,'committed');
 const {input}=rootAndInput(empty,sealed);assert.deepEqual(computeBoard(input).winners,[]);
 const unresolved=await cutoffScenario({post:false,beforeFreeze({db}){
  db.prepare("UPDATE earn_fixture_campaigns SET activation_ms=? WHERE token_id='A'").run(start-2*DAY_MS);
  const read=recordSamplePrice(db,{wallet:'unresolved',tokenId:'A',asOfMs:start-2*DAY_MS,stakedUnits:'10000000',validUntilMs:start-2*DAY_MS+100});
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('unresolved-post','unresolved','A',epoch-2,'https://example.test/unresolved',start-2*DAY_MS+1,read.receipt,'unresolved-key');
 }});t.after(()=>unresolved.db.close());
 const held=await selection(unresolved);assert.equal(held.dependencies.length,1);assert.equal(held.requirements.find(r=>r.gaps.length).kind,'previous-board');
 assert.equal((await unresolved.service.assemble(unresolved.principal,unresolved.query)).reason,'snapshot-dependencies');
 assert.equal(unresolved.db.prepare('SELECT COUNT(*) n FROM app_epoch_inputs').get().n,0);
});
test('late approval belongs to its exact UTC review day and the next midnight cannot extend the closing day',async t=>{
 const env=await cutoffScenario({beforeFreeze:multiwallet,historyStartMs:start-2*DAY_MS});t.after(()=>env.db.close());
 for(const reviewedMs of [start,cutoff]){
  env.db.prepare("UPDATE earn_reviews SET reviewed_ms=? WHERE submission_id='synthetic-delayed-post'").run(reviewedMs);
  const selected=await selection(env);assert.equal(selected.kind,'ready');
  assert.equal(selected.inventory.inputs.find(i=>i.kind==='late-approvals').value[0].reviewed_ms,reviewedMs);
  const sealed=await env.service.assemble(env.principal,env.query);assert.equal(sealed.kind,'committed');
  const plan=computeBoard(rootAndInput(env,sealed).input);assert.equal(plan.streaks.find(s=>s.wallet==='late-only').lastApprovalMs,reviewedMs);
 }
 env.db.prepare("UPDATE earn_reviews SET reviewed_ms=? WHERE submission_id='synthetic-delayed-post'").run(cutoff+1);
 const selected=await selection(env);assert.equal(selected.kind,'ready');
 assert.deepEqual(selected.inventory.inputs.find(i=>i.kind==='late-approvals').value,[]);
 const sealed=await env.service.assemble(env.principal,env.query);assert.equal(sealed.kind,'committed');
 assert.ok(!computeBoard(rootAndInput(env,sealed).input).streaks.some(s=>s.wallet==='late-only'));
});
