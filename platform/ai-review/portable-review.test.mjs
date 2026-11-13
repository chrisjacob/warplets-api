import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createWebCrypto} from '../security/web-crypto.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {evaluateSubmission,verifyReport,creatorFeedback,createAppeal,verifyAppeal} from './review.mjs';
import {createPortableReviewCodec} from './portable-review.mjs';
import {exampleJob,syntheticProvider} from './fixture.mjs';
const crypto=createWebCrypto(webcrypto),codec=createPortableReviewCodec({crypto}),time=Date.parse(exampleJob.capturedAt)+1000;
const report=()=>evaluateSubmission({job:exampleJob,provider:syntheticProvider,nowMs:time});
const rehash=value=>{value.reportId=createHash('sha256').update(canonicalJson(value.payload)).digest('hex');return value;};

test('WebCrypto report, feedback and appeal bytes exactly match existing synchronous Node artifacts',async()=>{
 const r=await report();assert.deepEqual(await codec.verifyReport(r),verifyReport(r));assert.deepEqual(await codec.creatorFeedback(r),creatorFeedback(r));
 const input={report:r,reason:'Please reconsider the supporting example.',createdAt:new Date(time+1).toISOString()};
 const a=await codec.createAppeal(input);assert.deepEqual(a,createAppeal(input));assert.deepEqual(await codec.verifyAppeal(a),verifyAppeal(a));
});

test('portable verification rejects independently forged hashes, ungrounded evidence, arithmetic and provenance',async()=>{
 const r=await report();
 const mutations=[p=>p.inputHash='0'.repeat(64),p=>p.contentHash='0'.repeat(64),p=>p.contextHash='0'.repeat(64),p=>p.promptHash='0'.repeat(64),p=>p.score=(p.score+1)%11,p=>p.evaluation.criteria[0].evidence[0].quote='forged',p=>p.provider.provenance='declared-local-adapter',p=>p.financialExecution=true,p=>p.lineage.extra='forged'];
 for(const mutate of mutations){const changed=structuredClone(r);mutate(changed.payload);rehash(changed);assert.throws(()=>verifyReport(changed));await assert.rejects(codec.verifyReport(changed));}
 const changed=structuredClone(r);changed.reportId='a'.repeat(64);await assert.rejects(codec.verifyReport(changed),/integrity/);
});

test('async verification snapshots inputs before yielding and never shares mutable cross-call evidence',async()=>{
 const original=await report(),input=structuredClone(original);let release;
 // Delay only the first hash so subsequent evidence hashes run normally.
 let first=true;const snapshot=createPortableReviewCodec({crypto:{async sha256(bytes){if(first){first=false;await new Promise(resolve=>release=resolve);}return crypto.sha256(bytes);}}});
 const pending=snapshot.verifyReport(input);input.payload.capturedJob.content='changed while hashing';release();assert.deepEqual(await pending,original);
 assert(Object.isFrozen(await codec.verifyReport(original)));
});

test('portable appeal validation rejects changed reason or fabricated authority',async()=>{
 const a=await codec.createAppeal({report:await report(),reason:'Please check this example.',createdAt:new Date(time+1).toISOString()});
 const changed=structuredClone(a);changed.payload.reason='Different reason';await assert.rejects(codec.verifyAppeal(changed),/integrity/);
 const authority=structuredClone(a);authority.payload.financialExecution=true;await assert.rejects(codec.verifyAppeal(authority),/integrity/);
});
