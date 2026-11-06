import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {projectCollectionFairness} from './fairness-projection.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {fairnessProjectionFixture as fixture,recordedFairnessProof as proof} from './fairness-projection.fixtures.mjs';
const crypto=createNodeCrypto(),hash=v=>crypto.sha256(utf8(canonicalJson(v)));
// Synthetic verifier exercises projection flow, NOT BLS authenticity. The real
// pinned adapter is independently exercised below from its installed package.
const syntheticVerifier={verifyShortSignature:()=>true};

const project=f=>projectCollectionFairness(f,{crypto,beaconVerifier:syntheticVerifier});
test('sealed public and owner combinations expose only opaque commitment/status, never round/context/proof/order/outcome',async()=>{
 const f=await fixture();for(const [section,key] of [['assignment','irreversible'],['disclosure','selectedRevealed'],['disclosure','mintPrefixRevealed']]){const v=structuredClone(f);v[section][key]=false;const out=await project(v);assert.equal(out.disclosure,'sealed');assert.equal(out.transcript,null);assert.equal(out.financialState,'not-applicable-local');assert.match(out.commitment,/^[a-f0-9]{64}$/);const combined=JSON.stringify({fairness:out,existingOwnerReceipt:{id:f.operation.id,createdAt:new Date(f.operation.createdMs).toISOString()},publicPolicy:{policyHash:f.policy.policyHash}});for(const secret of [f.operation.rawCommitment,f.request.contextDigest,f.result.proof.signature,f.result.proof.randomness,f.result.proofId,f.result.fixture.assetId,...Object.values(f.result.fixture.traits)])assert.ok(!combined.includes(secret),secret);assert.deepEqual(Object.keys(out).sort(),['format','source','providerStatus','requiresVerifiedRepository','requestState','evidenceState','financialState','commitment','disclosure','transcript','financialExecution','serverSigning','broadcast'].sort());}
 const noVerifier=await projectCollectionFairness(f,{crypto});assert.equal(noVerifier.disclosure,'sealed');assert.equal(noVerifier.evidenceState,'retained-unverified');
});
test('recorded replay transcript releases only after all gates, preserves exact protocol and has no reserved/future mapping',async()=>{
 const f=await fixture(),before=canonicalJson(f),out=await project(f);assert.equal(out.disclosure,'revealed');assert.equal(out.evidenceState,'verified');assert.equal(out.providerStatus,'candidate-unselected');assert.equal(out.transcript.fixture.ticket,f.result.fixture.ticket);assert.equal(out.transcript.selectedAssignment.level,f.assignment.level);assert.equal(out.transcript.contextDigest,f.request.contextDigest);assert.deepEqual(out.transcript.remainingQuotas,LEVEL_QUOTAS);const {digest,...transcript}=out.transcript;assert.equal(digest,await hash(transcript));assert.equal(transcript.verificationScope,'recorded-beacon-draw-only');assert.equal(transcript.reservedAssetMapping,'withheld');assert.equal(Object.hasOwn(transcript,'reservedAssets'),false);assert.deepEqual(await project(structuredClone(f)),out);assert.equal(canonicalJson(f),before);assert.ok(Object.isFrozen(out.transcript));assert.equal(out.financialExecution,false);
 for(const kind of ['visual','upgrade']){const v=await fixture(kind);v.disclosure.participantsRevealed=false;assert.equal((await project(v)).disclosure,'sealed');v.disclosure.participantsRevealed=true;assert.equal((await project(v)).disclosure,'revealed');assert.equal((await project(v)).transcript.remainingQuotas,null);}
});
test('missing replay/policy stays sealed; conflicting proof, result, context or timing never causes a new draw',async()=>{
 const f=await fixture();for(const mutate of [v=>v.policy.traitChoices=null,v=>v.remainingQuotas=null,v=>v.result=null]){const v=structuredClone(f);mutate(v);assert.equal((await project(v)).disclosure,'sealed');}
 for(const mutate of [v=>v.result.fixture.ticket++,v=>v.request.contextDigest='b'.repeat(64),v=>v.result.proof.signature='0'.repeat(96),v=>v.operation.createdMs++,v=>v.assignment.level=v.assignment.level===1?2:1]){const v=structuredClone(f);mutate(v);const r=await project(v);assert.equal(r.disclosure,'sealed');assert.equal(r.evidenceState,'conflicted');assert.equal(r.transcript,null);}
 const manual=structuredClone(f);manual.policy=null;manual.request=null;assert.equal((await project(manual)).evidenceState,'manual-fixture');assert.equal((await project(manual)).transcript,null);
});
test('input is captured before async hashing and unknown fields/accessors cannot escape the bounded transcript',async()=>{
 const f=await fixture(),expected=await project(f),copy=structuredClone(f);let changed=false;const r=await projectCollectionFairness(copy,{beaconVerifier:syntheticVerifier,crypto:{async sha256(bytes){if(!changed){changed=true;copy.operation.rawCommitment='mutated';copy.disclosure.selectedRevealed=false;copy.result.fixture.ticket++;}return crypto.sha256(bytes);}}});assert.deepEqual(r,expected);let invoked=false;const bad={};Object.defineProperty(bad,'operation',{enumerable:true,get(){invoked=true;return f.operation;}});await assert.rejects(project(bad),/data fields/);assert.equal(invoked,false);await assert.rejects(project({...f,reservedAssets:['FUTURE_PRIVATE_ASSET']}),/facts shape/);await assert.rejects(project({...f,extra:'x'.repeat(262144)}),/input bound/);
});
test('actual installed pinned BLS adapter verifies recorded transcript and rejects another-round signature',async()=>{
 const {createNobleBeaconVerifier}=await import('../beacon/noble-verifier.mjs'),f=await fixture(),out=await projectCollectionFairness(f,{crypto,beaconVerifier:createNobleBeaconVerifier()});assert.equal(out.disclosure,'revealed');assert.equal(out.evidenceState,'verified');f.result.proof={...f.result.proof,round:proof.round+1};const bad=await projectCollectionFairness(f,{crypto,beaconVerifier:createNobleBeaconVerifier()});assert.equal(bad.disclosure,'sealed');assert.equal(bad.evidenceState,'conflicted');
});
