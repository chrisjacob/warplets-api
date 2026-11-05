import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createWebCrypto} from '../security/web-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createQuoteComparison} from './quote-comparison.mjs';
import {loadQuoteComparisonFixture} from './fixtures/quote-comparison-fixture.mjs';

const crypto=createNodeCrypto(),comparator=createQuoteComparison({crypto});
const fixture=await loadQuoteComparisonFixture(crypto),copy=structuredClone;
const selected=()=>{const r=fixture.records.find(r=>r.observed.kind==='amounts'&&r.direction==='sell-att');return {r:copy(r),e:copy(fixture.requirements.find(q=>q.id===r.id).expected)};};
const pinRecord=async(r,e)=>{e.recordDigest=await crypto.sha256(utf8(canonicalJson(r)));return e;};

test('all80 pinned SDK rows compare independently;8 absent exact-state program pairs remain missing in both crypto adapters',async()=>{
 const input={records:fixture.records,requirements:fixture.requirements},node=await comparator.matrix(input),web=await createQuoteComparison({crypto:createWebCrypto()}).matrix(input);
 assert.deepEqual(node,web);assert.deepEqual(node.counts,{matched:80,missing:8,failed:0});assert.equal(node.executable,false);assert.equal(node.financialExecution,false);
 for(const item of node.items.filter(i=>i.status==='matched')){
  assert.equal(item.comparisons[0].evidenceKind,'synthetic-sdk');assert.equal(item.comparisons[0].scope,'synthetic-arithmetic');assert.equal(item.comparisons[0].coverage,'raw-pool-only');
  assert.equal(item.comparisons[0].hashes.programBinaryDigest,null);assert.equal(item.comparisons[0].financialExecution,false);
 }
 for(const item of node.items.filter(i=>i.status==='missing')){assert.match(item.id,/^captured-program:/);assert.equal(item.reason,'exact-pre-swap-state-and-full-observed-deltas-not-retained');assert.deepEqual(item.comparisons,[]);}
 assert.ok(Object.isFrozen(node)&&Object.isFrozen(node.items)&&Object.isFrozen(node.items[0].comparisons[0]));
 assert.equal(fixture.inventory.sources[0].label,'cp-amm-sdk 1.5.1 / synthetic raw pool bytes / no RPC');
 for(const direction of ['buy-att','sell-att'])for(const elapsed of [0,88,89,90])assert.ok(fixture.records.some(r=>r.direction===direction&&r.currentPointMs-r.activationMs===elapsed*1000));
});

test('independent pins bind source, exact pool state, identities, decoder, clock, direction and amount',async()=>{
 const {r,e}=selected();
 const changes=[['source-file-mismatch',x=>x.sourceFileDigest='1'.repeat(64)],['source-commit-mismatch',x=>x.sourceCommit='1'.repeat(40)],
  ['recording-mismatch',x=>x.recordingId='another-record'],['pre-state-mismatch',x=>x.rawPool.byteDigest='1'.repeat(64)],
  ['program-mismatch',x=>x.program.decoderVersion='future-layout'],['pool-address-mismatch',x=>x.rawPool.address=r.identities.attMint],
  ['identities-mismatch',x=>x.identities.ogMint=r.identities.attVault],['activation-mismatch',x=>x.activationMs++],['current-point-mismatch',x=>x.currentPointMs++],
  ['direction-mismatch',x=>x.direction='buy-att'],['input-mismatch',x=>x.inputUnits='2'],['slippage-mismatch',x=>x.slippageBps++],['record-pin-mismatch',x=>x.recordDigest='1'.repeat(64)]];
 for(const [reason,change] of changes){const wanted=copy(e);change(wanted);const result=await comparator.compare(r,wanted);assert.equal(result.status,'incompatible',reason);assert.equal(result.reason,reason);}
 const captured=copy(e);captured.evidenceKind='captured-program';captured.program.binaryDigest=fixture.inventory.capturedProgram.datedBinaryDigest;
 assert.equal((await comparator.compare(r,captured)).reason,'evidence-kind-mismatch');
 const matrix=await comparator.matrix({records:[r],requirements:[{id:'captured-pair',expected:captured,recordIds:[r.id],missingReason:null}]});
 assert.equal(matrix.items[0].status,'missing');assert.equal(matrix.items[0].reason,'no-compatible-record');assert.equal(matrix.items[0].comparisons[0].status,'incompatible');
});

test('raw pool corruption and unsupported layouts cannot satisfy a newly pinned record',async()=>{
 const {r,e}=selected();const bytes=Uint8Array.from(atob(r.rawPool.data),c=>c.charCodeAt(0));bytes[100]^=1;
 r.rawPool.data=btoa(String.fromCharCode(...bytes));await pinRecord(r,e);
 assert.equal((await comparator.compare(r,e)).reason,'raw-pool-digest-mismatch');
 const mismatch=selected();mismatch.r.identities.attVault=mismatch.r.identities.ogVault;mismatch.e.identities=copy(mismatch.r.identities);await pinRecord(mismatch.r,mismatch.e);
 assert.equal((await comparator.compare(mismatch.r,mismatch.e)).reason,'decoded-identities-mismatch');
 const unsupported=selected();const raw=Uint8Array.from(atob(unsupported.r.rawPool.data),c=>c.charCodeAt(0));raw[16]=1;
 unsupported.r.rawPool.data=btoa(String.fromCharCode(...raw));unsupported.r.rawPool.byteDigest=await crypto.sha256(raw);unsupported.e.rawPool.byteDigest=unsupported.r.rawPool.byteDigest;await pinRecord(unsupported.r,unsupported.e);
 assert.equal((await comparator.compare(unsupported.r,unsupported.e)).reason,'pool-fee_schedule');
 const malformed=selected();malformed.r.rawPool.data+='\n';await pinRecord(malformed.r,malformed.e);assert.equal((await comparator.compare(malformed.r,malformed.e)).reason,'raw-pool-encoding');
});

test('full fee and net output deltas are checked; protocol-share-only deltas fail',async()=>{
 const {r,e}=selected();r.observed.outputUnits=String(BigInt(r.observed.outputUnits)+1n);r.observed.grossOutputUnits=String(BigInt(r.observed.grossOutputUnits)+1n);await pinRecord(r,e);
 const changed=await comparator.compare(r,e);assert.equal(changed.status,'failed');assert.equal(changed.reason,'observed-delta-mismatch');assert.ok(changed.differences.includes('outputUnits'));
 const share=selected();share.r.observed.totalFeeUnits=String(BigInt(share.r.observed.totalFeeUnits)/5n);await pinRecord(share.r,share.e);
 assert.equal((await comparator.compare(share.r,share.e)).reason,'observed-deltas-inconsistent');
 const coherent=selected();coherent.r.observed.totalFeeUnits=String(BigInt(coherent.r.observed.totalFeeUnits)/5n);coherent.r.observed.outputFeeUnits=coherent.r.observed.totalFeeUnits;
 coherent.r.observed.grossOutputUnits=String(BigInt(coherent.r.observed.outputUnits)+BigInt(coherent.r.observed.outputFeeUnits));await pinRecord(coherent.r,coherent.e);
 assert.equal((await comparator.compare(coherent.r,coherent.e)).reason,'observed-delta-mismatch');
 const matrix=await comparator.matrix({records:[r],requirements:[{id:'independently-recorded-wrong-output',expected:e,recordIds:[r.id],missingReason:null}]});assert.equal(matrix.counts.failed,1);
});

test('rejection comparisons demand the exact recorded error code, including dust and range',async()=>{
 for(const errorCode of ['dust_input','dust_output','price_range']){
  const r=copy(fixture.records.find(r=>r.observed.kind==='rejected'&&r.observed.errorCode===errorCode));assert.ok(r);
  const e=copy(fixture.requirements.find(q=>q.id===r.id).expected),matched=await comparator.compare(r,e);
  assert.equal(matched.reason,'expected-rejection');assert.equal(matched.expectedErrorCode,errorCode);assert.equal(matched.actualErrorCode,errorCode);
  r.observed.errorCode='overflow';await pinRecord(r,e);const failed=await comparator.compare(r,e);assert.equal(failed.status,'failed');assert.equal(failed.actualErrorCode,errorCode);
 }
 const {r,e}=selected();r.observed={kind:'rejected',errorCode:'price_range'};await pinRecord(r,e);assert.equal((await comparator.compare(r,e)).reason,'expected-rejection-not-returned');
});

test('strict record and matrix boundaries reject unknown fields, duplicate candidates and fabricated captured metadata',async()=>{
 const {r,e}=selected();await assert.rejects(()=>comparator.compare({...r,wallet:'spoof'},e),/record fields/);
 const captured={...r,evidenceKind:'captured-program'};await assert.rejects(()=>comparator.compare(captured,e),/binary digest/);
 captured.program={...r.program,binaryDigest:fixture.inventory.capturedProgram.datedBinaryDigest};captured.observed={kind:'rejected',errorCode:'dust_input'};
 await assert.rejects(()=>comparator.compare(captured,e),/synthetic error code/);
 await assert.rejects(()=>comparator.compare({...r,rawPool:{...r.rawPool,address:'not-a-key'}},e),/canonical account/);
 await assert.rejects(()=>comparator.matrix({records:[r,r],requirements:[]}),/duplicate record/);
 await assert.rejects(()=>comparator.matrix({records:[r],requirements:[{id:'bad',expected:null,recordIds:[r.id],missingReason:'unknown'}]}),/missing requirement/);
 await assert.rejects(()=>comparator.matrix({records:[],requirements:Array.from({length:129},()=>({}))}),/matrix row bound/);
 const missing=await comparator.matrix({records:[],requirements:[{id:'lost-retained-record',expected:e,recordIds:[r.id],missingReason:null}]});assert.equal(missing.items[0].reason,'candidate-record-unavailable');
});

test('record, expected pins and complete applicability matrix are copied before async digest work',async()=>{
 const {r,e}=selected();let fired=false;
 const delayed={...crypto,async sha256(bytes){if(!fired){fired=true;r.observed.outputUnits='0';e.recordDigest='0'.repeat(64);e.currentPointMs++;}await Promise.resolve();return crypto.sha256(bytes);}};
 assert.equal((await createQuoteComparison({crypto:delayed}).compare(r,e)).status,'matched');
 const next=selected(),input={records:[next.r],requirements:[{id:'stable',expected:next.e,recordIds:[next.r.id],missingReason:null}]};let changed=false;
 const mutate={...crypto,async sha256(bytes){if(!changed){changed=true;input.records[0].observed.outputUnits='0';input.requirements.length=0;}return crypto.sha256(bytes);}};
 const result=await createQuoteComparison({crypto:mutate}).matrix(input);assert.equal(result.counts.matched,1);assert.equal(result.items[0].id,'stable');
});
