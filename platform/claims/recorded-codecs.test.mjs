import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encodeRecordedLinearSchedule,decodeRecordedLinearSchedule,encodeRecordedLeafPayload,decodeRecordedLeafPayload,inspectRecordedClaim,verifyRecordedClaimSources,REWARDS_PROGRAM,REWARDS_ROOT_FORMAT} from './recorded-codecs.mjs';
// Retained replay start=1800000000 plus24h/48h. The literal byte expectation
// was independently checked with Python struct.pack('<QQ', start+86400,
// start+172800); it is a wire-shape assertion, not a recorded Merkle vector.
const schedule={kind:'linear',startsAtSeconds:'1800086400',endsAtSeconds:'1800172800'};
test('retained linear schedule has fixed tag and little-endian timestamps, separate from leaf claimant bytes',()=>{
 const encoded=encodeRecordedLinearSchedule(schedule);assert.equal(Buffer.from(encoded).toString('hex'),'0180234b6b0000000000754c6b00000000');assert.deepEqual(decodeRecordedLinearSchedule(encoded),schedule);
 const payload=encodeRecordedLeafPayload({claimantHex:'12'.repeat(32),amountUnits:'100',schedule});assert.equal(payload.length,57);assert.equal(Buffer.from(payload.subarray(32,40)).toString('hex'),'6400000000000000');assert.deepEqual(decodeRecordedLeafPayload(payload),{claimantHex:'12'.repeat(32),amountUnits:'100',schedule});
 assert.throws(()=>decodeRecordedLinearSchedule(new Uint8Array(17)),/unsupported/);assert.throws(()=>encodeRecordedLinearSchedule({...schedule,endsAtSeconds:schedule.startsAtSeconds}));assert.throws(()=>encodeRecordedLeafPayload({claimantHex:'12'.repeat(32),amountUnits:'18446744073709551616',schedule}));
 assert.throws(()=>encodeRecordedLeafPayload({claimantHex:'12'.repeat(32),amountUnits:'100',schedule,extra:true}));let reads=0;const getter={claimantHex:'12'.repeat(32),amountUnits:'100',get schedule(){reads++;return schedule;}};assert.throws(()=>encodeRecordedLeafPayload(getter));assert.equal(reads,0);
});
test('claimant semantics stay distinct and missing proof vectors cannot become verified claims',()=>{
 const input={program:REWARDS_PROGRAM,rootFormat:REWARDS_ROOT_FORMAT,rootHex:'a'.repeat(64),distributionHex:'b'.repeat(64),mintHex:'c'.repeat(64),claimantType:'wallet-bound',assetHex:null,payload:encodeRecordedLeafPayload({claimantHex:'12'.repeat(32),amountUnits:'100',schedule})};
 const wallet=inspectRecordedClaim(input),asset=inspectRecordedClaim({...input,claimantType:'asset-signer',assetHex:'d'.repeat(64)});
 assert.equal(wallet.signerDerivation,'not-applicable');assert.equal(asset.signerDerivation,'unverified');assert.equal(asset.currentOwnerVerified,false);assert.equal(wallet.proofStatus,'missing-frozen-leaf-root-proof-vectors');assert.equal(wallet.distributionAndMintBinding,'unverified-account-context');assert.equal(wallet.isAuthorization,false);assert.equal(asset.financialExecution,false);
 assert.throws(()=>inspectRecordedClaim({...input,rootFormat:'10x.local.earn.public.v1'}),/Earn SHA-256/);assert.throws(()=>inspectRecordedClaim({...input,rootFormat:'sha256'}));assert.throws(()=>inspectRecordedClaim({...input,claimantType:'asset-signer'}));
});
test('shape evidence is pinned to retained replay sources and does not claim matching hash vectors',async()=>{
 const crypto=createNodeCrypto(),readSource=path=>readFile(new URL('../../'+path,import.meta.url));assert.equal((await verifyRecordedClaimSources({crypto,readSource})).proofVectors,'missing');await assert.rejects(verifyRecordedClaimSources({crypto,readSource:async()=>new Uint8Array([0])}),/source mismatch/);
});
