import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createRecordedGateIndex,PROTOCOL_STATUS_SOURCE} from './recorded-gates.mjs';
const crypto=createNodeCrypto();
const readSource=path=>readFile(new URL('../../'+path,import.meta.url));

test('retained report produces scoped incompatible records without execution or review authority',async()=>{
 const index=await createRecordedGateIndex({readSource,crypto});
 assert.equal(index.records.length,2);
 for(const r of index.records){assert.equal(r.status,'incompatible');assert.deepEqual(r.source,PROTOCOL_STATUS_SOURCE);assert.equal(r.slot,null);assert.equal(r.observedAtMs,null);assert.equal(r.acceptedScope,null);}
 assert.equal(index.sourceAuthority,'caller-supplied-unverified');
 assert.equal(index.financialExecution,false);assert.equal(index.isAuthorization,false);assert.equal(index.releaseAuthorized,false);
 assert.ok(index.requirements.every(r=>r.hasIncompatibility&&!r.executionEnabled&&r.reviewAuthority==='unverified'));
 assert.match(index.records.find(r=>r.program==='Foundation Rewards').limitations[0],/outside this finding/);
});

test('rejects missing, oversized and tampered report bytes',async()=>{
 const original=await readSource(PROTOCOL_STATUS_SOURCE.path),tampered=Uint8Array.from(original);tampered[0]^=1;
 for(const bytes of [null,'report',new Uint8Array(65537),tampered])await assert.rejects(createRecordedGateIndex({readSource:async()=>bytes,crypto}));
 await assert.rejects(createRecordedGateIndex({readSource:async()=>{throw new Error('missing');},crypto}),/missing/);
});
