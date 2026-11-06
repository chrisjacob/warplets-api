import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacyMintAuditFixture} from '../../collect/legacy-mint-audit.fixtures.mjs';
import {auditLegacyMint} from '../../collect/legacy-mint-audit.mjs';
import {settleBeaconDraw} from '../../beacon/quicknet.mjs';
import {createNobleBeaconVerifier} from '../../beacon/noble-verifier.mjs';
import {localRuntime} from './local-runtime.mjs';
const proof=JSON.parse(readFileSync(new URL('../../beacon/fixtures/round-30000000.json',import.meta.url)));
const wire=input=>({...input,sourceRoot:{id:input.sourceRoot.id,size:input.sourceRoot.size,base64:Buffer.from(input.sourceRoot.bytes).toString('base64')},admissionPage:{id:input.admissionPage.id,size:input.admissionPage.size,base64:Buffer.from(input.admissionPage.bytes).toString('base64')}});
test('actual workerd audits retained legacy mint against real pinned BLS and bounded original R2 parts',async t=>{
 const f=await legacyMintAuditFixture(t,{configured:true,large:true,retainedProof:proof,settleConfigured:settleBeaconDraw}),{mf}=await localRuntime(t,new URL('./fixtures/legacy-mint-audit-worker.ts',import.meta.url)),bucket=await mf.getR2Bucket('MANIFESTS');for(const [digest,bytes] of f.parts)await bucket.put('synthetic-legacy-policy/'+digest,bytes);
 const node=await auditLegacyMint(f.input(),{...f.ports,beaconVerifier:createNobleBeaconVerifier()}),call=async input=>{const response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(wire(input))});return {status:response.status,...await response.json()};},edge=await call(f.input());assert.equal(edge.status,200,JSON.stringify(edge));assert.deepEqual(edge.result,node);assert.equal(edge.reads,25);assert.ok(edge.measurements.workingBytes<=1048576);assert.ok(edge.measurements.maxPartBytes<=65536);
 const missing=f.input().configured.policy.traits.model.pages[0].byteDigest,original=f.parts.get(missing);await bucket.delete('synthetic-legacy-policy/'+missing);const held=await call(f.input());assert.equal(held.status,200);assert.deepEqual(held.result,{kind:'held',reason:'original-policy-preimage-missing'});await bucket.put('synthetic-legacy-policy/'+missing,new Uint8Array(original.length+1));const oversized=await call(f.input());assert.equal(oversized.status,409);assert.match(oversized.error,/legacy-mint-policy-part-size/);await bucket.put('synthetic-legacy-policy/'+missing,original);
 const wrong=structuredClone(f.input()),round=JSON.parse(wrong.configured.result.signedRoundJson);round.signature='82'+round.signature.slice(2);round.randomness=await f.ports.crypto.sha256(Uint8Array.from(round.signature.match(/../g),v=>parseInt(v,16)));wrong.configured.result.signedRoundJson=JSON.stringify(Object.fromEntries(Object.entries(round).sort(([a],[b])=>a.localeCompare(b))));const invalid=await call(wrong);assert.equal(invalid.status,409);assert.equal(invalid.code,'legacy-mint-beacon-verification');assert.equal((await mf.dispatchFetch('http://localhost/api/v1/legacy-mint-audit')).status,404);
 t.diagnostic(JSON.stringify({realPinnedRound:proof.round,legacyOperationSettledByPinnedVerifier:true,reads:edge.reads,measurements:edge.measurements,policyBytes:f.db.prepare('SELECT length(CAST(traits AS BLOB)) n FROM fair_inventories').get().n,applicationActivation:false,financialExecution:false}));
});
