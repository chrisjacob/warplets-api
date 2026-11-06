import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedOutcomeFixture} from './recorded-transaction-outcomes.fixtures.mjs';
import {createActionRecoveryReadRepository} from '../transactions/recovery-reads.mjs';
import {recordReceipt,expireAttempt} from '../transactions/intents.mjs';
const fixture=t=>recordedOutcomeFixture(t);
test('retained synthetic unknown reconciles to confirmed/finalized with exact event bytes and accepted replay',async t=>{const f=await fixture(t),digest=await f.ingest('confirmed'),request=f.request(digest),before=f.counts(),result=await f.service.record(f.principal,request);assert.equal(result.kind,'committed',JSON.stringify(result));assert.equal(result.value.state,'confirmed');assert.equal(result.value.legacyAuthority,'unverified');assert.equal(result.value.financialExecution,false);assert.equal(f.counts().revision,before.revision+1);
 const event=f.db.prepare('SELECT * FROM tx_receipts WHERE event_id=?').get(result.value.eventId),raw=JSON.parse(f.db.prepare('SELECT decision_json FROM app_evidence_receipts WHERE receipt_digest=?').get(digest).decision_json).decoded;assert.equal(event.observation,f.legacy.canonical({attemptId:raw.attemptId,signature:raw.signature,state:raw.state,genesisHash:raw.genesisHash,messageHash:raw.messageHash}));
 assert.throws(()=>recordReceipt(f.db,{...raw,eventId:'unguarded-bypass',state:'unknown'}),/guarded|recorded|provenance/i);
 const final=await f.service.record(f.principal,f.request(await f.ingest('finalized'),'final-key'));assert.equal(final.kind,'committed');assert.equal(final.value.state,'finalized');
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(f.principal.id);f.store.objects.clear();f.setNow(f.now+99999999);const replay=await f.service.record(f.principal,request);assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,result.value);assert.equal(f.counts().bindings,2);
 assert.equal((await f.service.record(f.principal,{...request,expectedIntentRevision:999})).code,'idempotency_conflict');
 assert.throws(()=>recordReceipt(f.db,{...raw,eventId:'bypass',state:'unknown'}));assert.throws(()=>expireAttempt(f.db,{intentId:f.legacy.intent.id,currentBlockHeight:999}));
 assert.throws(()=>f.db.prepare("UPDATE tx_attempts SET signature='changed' WHERE id=?").run(raw.attemptId));
});
test('legacy exact event replays without backfill; changed old event and wrong signature cannot advance',async t=>{const f=await fixture(t),old=f.counts(),legacy=await f.service.record(f.principal,f.request(await f.ingest('legacy')));assert.equal(legacy.kind,'legacy-replayed');assert.equal(legacy.value.provenance,'legacy-recorded-unverified');assert.deepEqual(f.counts(),old);
 assert.equal((await f.service.record(f.principal,f.request(await f.ingest('changed'),'changed'))).code,'outcome_event_conflict');assert.equal((await f.service.record(f.principal,f.request(await f.ingest('wrong-signature'),'wrong'))).code,'outcome_attempt_mismatch');assert.deepEqual(f.counts(),old);
});
test('all mandatory children roll back; lost acknowledgement replays once',async t=>{for(const fault of ['omit-event','omit-binding','omit-intent','omit-attempt','alter-digest']){const f=await fixture(t),r=f.request(await f.ingest('confirmed')),before=f.counts();f.setFault(fault);await assert.rejects(f.service.record(f.principal,r));assert.equal(f.fired,1);assert.deepEqual(f.counts(),before);}
 const f=await fixture(t),r=f.request(await f.ingest('failed'));f.setFault('lose');const result=await f.service.record(f.principal,r);assert.equal(result.kind,'replayed');assert.equal(result.value.state,'failed');assert.equal(f.counts().bindings,1);
});
test('scope/source/clock changes at final claim cannot advance; missing bytes and revoked grant hold',async t=>{for(const fault of ['scope','head','clock']){const f=await fixture(t),r=f.request(await f.ingest('confirmed')),before=f.counts();f.setFault(fault);assert.equal((await f.service.record(f.principal,r)).kind,'conflict');assert.deepEqual(f.counts(),before);}
 const f=await fixture(t),r=f.request(await f.ingest('confirmed')),before=f.counts();f.store.objects.clear();assert.equal((await f.service.record(f.principal,r)).reason,'outcome-evidence-unavailable');assert.deepEqual(f.counts(),before);
});
test('concurrent duplicate import records once and unknown remains reconciliation-only',async t=>{const f=await fixture(t),r=f.request(await f.ingest('confirmed')),reader=createActionRecoveryReadRepository(f.driver,f.ports),before=await reader.readRecovery({kind:'wallet',wallet:f.legacy.owner},{intentId:f.legacy.intent.id});assert.equal(before.value.nextLocalTransition,'reconcile-existing-attempt');assert.equal(before.value.replacementEligible,false);
 const outcomes=await Promise.all([f.service.record(f.principal,r),f.service.record(f.principal,r)]);assert.deepEqual(outcomes.map(o=>o.kind).sort(),['committed','replayed']);assert.equal(f.counts().bindings,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_attempts').get().n,1);
});
