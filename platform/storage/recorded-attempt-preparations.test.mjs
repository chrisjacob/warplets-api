import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedPacketFixture,packetRecording,simulationRecording,retainPacket,retainHeight} from './recorded-attempt-preparations.fixtures.mjs';
import {createRecordedAttemptExpiryRepository} from './recorded-attempt-expiries.mjs';
import {createRecordedHeightService} from '../transactions/recorded-height-service.mjs';
import {createActionRecoveryReadRepository} from '../transactions/recovery-reads.mjs';
const prepare=async f=>{const input=f.request(await f.ingest('packet'));return {input,result:await f.service.prepare(f.principal,input)};};
async function expire(f,packet){const service=createRecordedHeightService({repository:createRecordedAttemptExpiryRepository(f.driver,{...f.ports,store:f.store}),crypto:f.ports.crypto});return service.expire(f.principal,await retainHeight(f,packet,packet.lifetime.lastValidBlockHeight+1));}
test('genuine recorded initial unsigned packet,067 expiry and fresh replacement preserve immutable predecessors',async t=>{
 const f=await recordedPacketFixture(t),{input,result}=await prepare(f);assert.equal(result.kind,'committed',JSON.stringify(result));assert.equal(result.value.index,1);assert.equal(result.value.executable,false);assert.equal(result.value.legacyAuthority,'unverified');
 const original=f.db.prepare('SELECT * FROM tx_attempts').get();assert.equal(original.signature,null);assert.equal((await expire(f,f.payload.packet)).kind,'committed');
 const expired=f.db.prepare('SELECT * FROM tx_attempts').get(),packet=packetRecording(f.legacy,{attemptId:'synthetic-imported-2',blockByte:21,slot:61,at:f.now,lastValid:300}),next=await retainPacket(f,packet,{simulation:simulationRecording(packet,{height:201})});
 const replacement=await f.service.prepare(f.principal,next);assert.equal(replacement.kind,'committed',JSON.stringify(replacement));assert.equal(replacement.value.index,2);assert.deepEqual(f.db.prepare('SELECT * FROM tx_attempts WHERE id=?').get(original.id),expired);assert.equal(f.counts().events,0);assert.equal(f.counts().revision,3);
 for(const query of ["UPDATE tx_attempts SET signature='fake' WHERE state='expired'","UPDATE tx_attempts SET state='awaiting_signature' WHERE state='expired'","UPDATE tx_attempts SET packet='{}' WHERE state='awaiting_signature'"]){assert.throws(()=>f.db.prepare(query).run());}
 const read=await createActionRecoveryReadRepository(f.driver,f.ports).readRecovery({kind:'wallet',wallet:f.legacy.owner},{intentId:f.legacy.intent.id});assert.equal(read.kind,'ready');assert.equal(read.value.attemptCount,2);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(f.principal.id);f.store.objects.clear();f.setNow(f.now+999999);const old=await f.service.prepare(f.principal,input);assert.equal(old.kind,'replayed');assert.deepEqual(old.value,result.value);assert.equal((await f.service.prepare(f.principal,{...input,expectedIntentRevision:9})).code,'idempotency_conflict');
});
test('awaiting and unresolved or terminal legacy attempts cannot be replaced; old exact legacy packet remains unupgraded',async t=>{
 for(const state of ['awaiting_signature','submitted','unknown','confirmed','failed','finalized','attempt_expired']){const f=await recordedPacketFixture(t,{state}),before=f.counts(),input=f.request(await f.ingest('packet'));if(state!=='attempt_expired'){assert.equal((await f.service.prepare(f.principal,input)).code,'attempt_preparation_conflict',state);assert.deepEqual(f.counts(),before);}
  const packet=f.legacy.packets[0],legacy=await retainPacket(f,packet,{simulation:{...simulationRecording(packet,{height:100}),ref:'synthetic-unverified-simulation-0'}}),replay=await f.service.prepare(f.principal,legacy);assert.equal(replay.kind,'legacy-replayed',JSON.stringify(replay));assert.equal(replay.value.state,state==='attempt_expired'?'expired':state);assert.equal(f.counts().bindings,0);
 }
});
test('all mandatory packet children and digest bindings roll back, and lost acknowledgement resolves one receipt',async t=>{
 for(const fault of ['omit-binding','omit-intent','omit-attempt','alter-digest']){const f=await recordedPacketFixture(t),input=f.request(await f.ingest('packet')),before=f.counts();f.setFault(fault);await assert.rejects(f.service.prepare(f.principal,input));assert.equal(f.fired,1);assert.deepEqual(f.counts(),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_attempts').get().n,0);}
 const f=await recordedPacketFixture(t),input=f.request(await f.ingest('packet'));f.setFault('lose');assert.equal((await f.service.prepare(f.principal,input)).kind,'replayed');assert.equal(f.counts().bindings,1);
});
test('scope,source,clock and missing raw evidence prevent new preparations without effects',async t=>{
 for(const fault of ['scope','head','clock']){const f=await recordedPacketFixture(t),input=f.request(await f.ingest('packet')),before=f.counts();f.setFault(fault);assert.equal((await f.service.prepare(f.principal,input)).kind,'conflict');assert.deepEqual(f.counts(),before);}
 const f=await recordedPacketFixture(t),input=f.request(await f.ingest('packet'));f.store.objects.clear();assert.equal((await f.service.prepare(f.principal,input)).reason,'packet-evidence-unavailable');
});
test('recorded messages and protections are independently checked, unknown lookups explicitly held',async t=>{
 for(const variant of ['amount','message','lookup','stale']){const f=await recordedPacketFixture(t),p=packetRecording(f.legacy,{attemptId:'bad-'+variant}),sim=simulationRecording(p);
  if(variant==='amount')sim.feeUnits='5001';if(variant==='message'){p.messageBase64=p.messageBase64.slice(0,-4)+'AAAA';}if(variant==='lookup'){p.lookupTables=[{address:f.legacy.owner,contextSlot:50,dataHash:'a'.repeat(64),addresses:[]}];sim.lookupTables=p.lookupTables;}
  const input=await retainPacket(f,p,{simulation:sim});if(variant==='stale')f.setNow(f.now+60001);const r=await f.service.prepare(f.principal,input);assert.equal(r.kind,'pending',JSON.stringify(r));if(variant==='lookup')assert.equal(r.reason,'independent-lookup-evidence-required');assert.equal(f.counts().bindings,0);
 }
});
test('replacement requires distinct message and blockhash plus nonregressing context and height',async t=>{
 for(const variant of ['blockhash','slot','time','height']){const f=await recordedPacketFixture(t);assert.equal((await prepare(f)).result.kind,'committed');assert.equal((await expire(f,f.payload.packet)).kind,'committed');const p=packetRecording(f.legacy,{attemptId:'replacement-'+variant,blockByte:variant==='blockhash'?20:21,slot:variant==='slot'?59:61,at:variant==='time'?f.legacy.now-1:f.now,lastValid:300}),sim=simulationRecording(p,{height:variant==='height'?200:201});const input=await retainPacket(f,p,{simulation:sim});assert.equal((await f.service.prepare(f.principal,input)).reason,'packet-replacement-not-fresh');assert.equal(f.counts().bindings,1);}
});
test('concurrent exact request commits one unsigned attempt and one receipt',async t=>{const f=await recordedPacketFixture(t),input=f.request(await f.ingest('packet')),results=await Promise.all([f.service.prepare(f.principal,input),f.service.prepare(f.principal,input)]);assert.deepEqual(results.map(x=>x.kind).sort(),['committed','replayed']);assert.equal(f.counts().bindings,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_attempts').get().n,1);});

test('sixteen retained attempts is an explicit preparation bound',async t=>{const f=await recordedPacketFixture(t,{state:'attempt_expired',attemptCount:16}),input=f.request(await f.ingest('packet'));assert.equal((await f.service.prepare(f.principal,input)).reason,'packet-history-unverifiable');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_attempts').get().n,16);assert.equal(f.counts().bindings,0);});
