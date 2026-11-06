import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEconomicPlanRepository} from './economic-plans.mjs';
import {economicPlanFixture as fixture,economicPlanRequest as request} from './economic-plans.fixtures.mjs';
const at=Date.UTC(2026,10,5,12),principal={kind:'wallet',wallet:'11111111111111111111111111111111'};
test('economic preparation retains original receipt, owner isolation and repeated trades without executable intents',async t=>{const f=await fixture(t),r=request(),first=await f.repo.prepare(r);assert.equal(first.kind,'committed');assert.deepEqual(f.counts(),{intents:1,preparations:1,receipts:1});
 const review=await f.repo.read({principal,...Object.fromEntries(Object.entries(first.value).filter(([k])=>k!=='planDigest'))});assert.equal(review.kind,'found');assert.equal(review.value.expired,false);assert.equal(review.value.plan.wire,null);
 const differentOwner={kind:'wallet',wallet:'So11111111111111111111111111111111111111112'};assert.equal((await f.repo.read({principal:differentOwner,intentId:first.value.intentId})).kind,'missing');
 const linked=await f.repo.prepare({...r,requestKey:'request-2'});assert.equal(linked.kind,'committed');assert.deepEqual(linked.value,first.value);assert.deepEqual(f.counts(),{intents:1,preparations:1,receipts:2});
 const changed=structuredClone(r);changed.request.maximumFeeUnits='20000';assert.equal((await f.repo.prepare(changed)).code,'idempotency_conflict');changed.requestKey='request-3';assert.equal((await f.repo.prepare(changed)).kind,'committed');assert.equal(f.counts().preparations,2);
 changed.requestKey='request-4';changed.request.parameters.inputUnits='2000000';assert.equal((await f.repo.prepare(changed)).code,'economic_intent_conflict');
 assert.equal((await f.repo.prepare({...r,intentKey:'trade-2',requestKey:'request-5'})).kind,'committed');assert.equal(f.counts().intents,2);
 f.setNow(at+60000);f.store.objects.clear();const replay=await f.repo.prepare(r);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,first.value);assert.equal((await f.repo.read({principal,intentId:first.value.intentId,preparationId:first.value.preparationId})).value.expired,true);
 assert.equal(f.db.prepare('SELECT count(*) n FROM tx_intents').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM tx_attempts').get().n,0);
});
test('both mandatory children roll back and lost acknowledgement returns retained receipt exactly',async t=>{for(const fault of ['omit-intent','omit-preparation']){const f=await fixture(t);f.setFault(fault);await assert.rejects(f.repo.prepare(request()));assert.deepEqual(f.counts(),{intents:0,preparations:0,receipts:0});}
 const f=await fixture(t);f.setFault('lose');const r=await f.repo.prepare(request());assert.equal(r.kind,'replayed');assert.equal(f.hit,1);assert.deepEqual(f.counts(),{intents:1,preparations:1,receipts:1});
});
test('actual claim clock, source and recovery generation changes cannot commit stale preparation',async t=>{for(const fault of ['clock','source','generation']){const f=await fixture(t);f.setFault(fault);const r=await f.repo.prepare(request());assert.equal(r.kind,'conflict',fault);assert.equal(f.hit,1);assert.deepEqual(f.counts(),{intents:0,preparations:0,receipts:0});}});
test('concurrent same request and distinct request keys retain one immutable economic intent',async t=>{const f=await fixture(t),r=request();const outcomes=await Promise.all([f.repo.prepare(r),f.repo.prepare(r)]);assert.deepEqual(outcomes.map(x=>x.kind).sort(),['committed','replayed']);assert.deepEqual(f.counts(),{intents:1,preparations:1,receipts:1});
 const next=await Promise.all([f.repo.prepare({...r,requestKey:'next-a'}),f.repo.prepare({...r,requestKey:'next-b'})]);assert.ok(next.every(x=>x.kind==='committed'));assert.deepEqual(f.counts(),{intents:1,preparations:1,receipts:3});
});

test('read verification fences the private target generation and watermark across awaited hashes',async t=>{
 const f=await fixture(t),accepted=await f.repo.prepare(request());let changed=false;
 const crypto={...f.crypto,async sha256(bytes){const result=await f.crypto.sha256(bytes);if(!changed&&new TextDecoder().decode(bytes).includes('"kind":"prepared-economic-plan"')){changed=true;f.db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.laterDisplay',1) WHERE id='persist-swap'").run();}return result;}};
 const reader=createEconomicPlanRepository(f.driver,{crypto,clock:f.clock,ids:{next:randomUUID}});
 assert.equal((await reader.read({principal,intentId:accepted.value.intentId})).reason,'economic-read-changed');assert.equal(changed,true);
 assert.equal((await f.repo.read({principal,intentId:accepted.value.intentId})).kind,'found');
 f.db.prepare("UPDATE app_recovery_state SET status='held' WHERE id=1").run();assert.equal((await f.repo.read({principal,intentId:accepted.value.intentId})).reason,'read-only-recovery');
 assert.equal((await f.repo.prepare(request())).kind,'replayed');
});
