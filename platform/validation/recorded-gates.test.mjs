import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createRecordedGateIndex,PROTOCOL_STATUS_SOURCE} from './recorded-gates.mjs';
const crypto=createNodeCrypto();
const readSource=path=>readFile(new URL('../../'+path,import.meta.url));

test('retained report produces scoped incompatible records without execution or review authority',async()=>{
 const index=await createRecordedGateIndex({readSource,crypto});
 assert.equal(index.records.length,9);
 for(const r of index.records){assert.deepEqual(r.source,PROTOCOL_STATUS_SOURCE);assert.equal(r.slot,null);assert.equal(r.observedAtMs,null);assert.equal(r.acceptedScope,null);}
 assert.equal(index.sourceAuthority,'caller-supplied-unverified');
 assert.equal(index.financialExecution,false);assert.equal(index.isAuthorization,false);assert.equal(index.releaseAuthorized,false);
 assert.ok(index.requirements.every(r=>!r.executionEnabled&&r.reviewAuthority==='unverified'));
 assert.match(index.records.find(r=>r.id==='rewards.wallet-leaf-nft-transfer').limitations[0],/outside this finding/);
 const owner=index.requirements.find(r=>r.id==='claims.current-nft-owner');
 assert.equal(owner.hasIncompatibility,true);assert.deepEqual(owner.statuses,['fixture-proven','incompatible']);
 assert.equal(index.records.filter(r=>r.status==='incompatible').length,4);
 assert.equal(index.records.find(r=>r.id==='kamino.fractional-precision').status,'review-required');
 assert.equal(index.records.find(r=>r.id==='costs.complete-operation').status,'review-required');
});

test('rejects missing, oversized and tampered report bytes',async()=>{
 const original=await readSource(PROTOCOL_STATUS_SOURCE.path),tampered=Uint8Array.from(original);tampered[0]^=1;
 for(const bytes of [null,'report',new Uint8Array(65537),tampered])await assert.rejects(createRecordedGateIndex({readSource:async()=>bytes,crypto}));
 await assert.rejects(createRecordedGateIndex({readSource:async()=>{throw new Error('missing');},crypto}),/missing/);
});
