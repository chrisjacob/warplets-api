import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createWebCrypto} from '../security/web-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {quoteFixture} from './fixtures.mjs';
import {createSyntheticQuoteCapture} from './verification-fixture.mjs';
import {inspectLegacyQuoteCapture,evaluateQuoteData,inspectQuoteCapture,verifyQuoteCapture,evaluateVerifiedQuote} from './verification.mjs';

const crypto=createNodeCrypto(),at=Date.UTC(2026,10,5,12),hash=v=>crypto.sha256(utf8(canonicalJson(v))),code=expected=>error=>error.code===expected;
const vector=JSON.parse(await readFile(new URL('./fixtures/sdk-vectors.json',import.meta.url)));
async function rebind(i){
 i.binding.sourceConfigDigest=await hash(i.source);i.binding.envelopeByteDigest=await hash(i.capture);i.binding.objectRef='private/'+i.binding.envelopeByteDigest+'.json';
 for(const k of ['contextSlot','blockTimeMs','retrievedAtMs'])i.binding[k]=i.capture[k];return i;
}
async function fixture(){
 const legacy=quoteFixture(at),core=createSyntheticQuoteCapture({legacy,originalUnits:vector.originalSupplyUnits,manifestDigest:await hash(['synthetic-unit-manifest',legacy.marketId]),oraclePublicationMs:at-5000});
 const source={version:1,sourceId:'synthetic-unit-only-source',sourceRevision:'v1',mode:'synthetic-fixture',chainGenesis:null,decoderVersion:'synthetic-quote-capture-v1',
  subject:{kind:'quote-market',id:core.market.id},policy:core.policy,recordingDigest:await hash(core.capture),maxBytes:32768,maxAgeMs:30000};
 // These are explicit unpersisted unit-test binding stubs. Integration tests
 // must obtain their receipt/head from the real B04 repository instead.
 const receiptDigest=await hash(['synthetic-unpersisted-unit-binding',core.capture]);
 const binding={receiptDigest,selectedHeadDigest:receiptDigest,sourceId:source.sourceId,sourceRevision:source.sourceRevision,sourceConfigDigest:'',
  streamKey:canonicalJson([source.sourceId,'quote-market',core.market.id,null]),envelopeByteDigest:'',objectRef:'',contextSlot:'',blockTimeMs:0,retrievedAtMs:0,ingestedAtMs:at};
 return {legacy,input:await rebind({market:core.market,supply:core.supply,source,capture:core.capture,binding}),request:{marketId:core.market.id,direction:'buy-att',inputUnits:'1000000',slippageBps:50}};
}
const inspect=i=>inspectQuoteCapture({market:i.market,supply:i.supply,source:i.source,capture:i.capture,ingestedAtMs:i.binding.ingestedAtMs});

test('portable verifier preserves legacy amounts in both directions and exposes separately bound clocks and five raw hashes',async()=>{
 const {input,request,legacy}=await fixture(),node=await verifyQuoteCapture(input,crypto),web=await verifyQuoteCapture(input,createWebCrypto());assert.deepEqual(node,web);
 const data=inspectLegacyQuoteCapture({...input.market,activatedAt:new Date(input.market.activationMs).toISOString()},legacy,input.supply.originalUnits,input.source.policy.approvedOgFeed,at);
 for(const direction of ['buy-att','sell-att']){
  const r={...request,direction,inputUnits:direction==='buy-att'?'1000000':'1000000000000'},quote=await evaluateVerifiedQuote({input:node,request:r,evaluatedAtMs:at},crypto);
  const old=evaluateQuoteData({data,request:r,nowMs:at,source:{contextSlot:legacy.slot,observedMs:at,sourceHash:node.sourceDigest}}),{id,evidence,...body}=quote;
  assert.deepEqual(body,old);assert.equal(id,await hash({...body,evidence}));assert.equal(evidence.oraclePublicationMs,at-5000);assert.equal(evidence.retrievedAtMs,at);
  assert.equal(evidence.ingestedAtMs,at);assert.equal(evidence.evaluatedAtMs,at);assert.equal(evidence.capturedProgramParity,'missing');assert.equal(evidence.programBinaryDigest,null);
  assert.equal(quote.executable,false);assert.equal(quote.fees.networkLamports,null);assert.equal(quote.fees.accountRentLamports,null);
  for(const key of ['pool','attMint','ogMint','attVault','ogVault'])assert.equal(evidence.accountByteDigests[key],await crypto.sha256(Uint8Array.from(atob(input.capture.accounts[key].data),c=>c.charCodeAt(0))));
  assert.ok(Object.isFrozen(quote)&&Object.isFrozen(quote.evidence.accountByteDigests));
 }
});

test('fresh retrieval cannot refresh oracle publication or account block time; expiry is the earliest original evidence boundary',async()=>{
 for(const change of [i=>i.capture.oracle.publicationMs=at-30000,i=>{i.capture.blockTimeMs=at-30000;for(const a of Object.values(i.capture.accounts))a.blockTimeMs=at-30000;}]){
  const {input}=await fixture();change(input);await rebind(input);assert.throws(()=>inspect(input),code('stale_quote_source'));
 }
 const {input,request}=await fixture();input.capture.oracle.publicationMs=at-29900;await rebind(input);
 const verified=await verifyQuoteCapture(input,crypto),quote=await evaluateVerifiedQuote({input:verified,request,evaluatedAtMs:at},crypto);assert.equal(Date.parse(quote.expiresAt),at+100);
 await assert.rejects(()=>evaluateVerifiedQuote({input:verified,request,evaluatedAtMs:at+100},crypto),code('stale_quote_source'));
 input.capture.oracle.publicationMs=at-5000;input.source.maxAgeMs=10000;await rebind(input);const bounded=await verifyQuoteCapture(input,crypto);
 assert.equal(Date.parse((await evaluateVerifiedQuote({input:bounded,request,evaluatedAtMs:at},crypto)).expiresAt),at+10000);
});

test('all account and oracle identities, finalized context, clock order, confidence and registered bounds fail closed',async()=>{
 const cases=[['mixed_checkpoint',i=>i.capture.accounts.attVault.contextSlot='12344'],['mixed_checkpoint',i=>i.capture.accounts.pool.blockTimeMs--],
  ['mixed_checkpoint',i=>i.capture.accounts.ogMint.retrievedAtMs++],['invalid_checkpoint',i=>i.capture.observedMs=at+1],
  ['oracle_checkpoint',i=>i.capture.oracle.publicationMs=at+1],['oracle_checkpoint',i=>i.capture.oracle.retrievedAtMs=at+1],
  ['oracle_slot_skew',i=>i.capture.oracle.publicationSlot='12344'],['oracle_slot_skew',i=>{i.capture.oracle.publicationSlot='12346';i.source.policy.maxOracleSlotSkew=5;}],
  ['oracle_mismatch',i=>i.capture.oracle.feed='unapproved'],['invalid_capture',i=>i.capture.oracle=null],['oracle_confidence',i=>i.capture.oracle.priceMicros='0'],
  ['oracle_confidence',i=>i.capture.oracle.confidenceMicros='20001'],['invalid_source',i=>i.source.policy.oracleMaxAgeMs=30001],
  ['invalid_source',i=>i.source.policy.maxConfidenceBps=101],['unverified_capture',i=>i.capture.finality='confirmed'],
  ['unverified_capture',i=>i.capture.investigationOpen=true],['unverified_capture',i=>i.source.mode='recorded-public'],
  ['identity_mismatch',i=>i.market.attMint=i.market.ogMint],['invalid_decimals',i=>i.source.policy.attDecimals=8],
  ['supply_mismatch',i=>i.supply.originalUnits='199'],['evidence_pending',i=>i.binding.selectedHeadDigest='1'.repeat(64)],
  ['evidence_binding',i=>i.binding.sourceRevision='changed'],['evidence_binding',i=>i.binding.streamKey='wrong']];
 for(const [errorCode,change] of cases){const {input}=await fixture();change(input);await rebind(input);
  await assert.rejects(()=>verifyQuoteCapture(input,crypto),code(errorCode),errorCode);
 }
 const allowed=await fixture();allowed.input.source.policy.maxOracleSlotSkew=2;allowed.input.capture.oracle.publicationSlot='12343';await rebind(allowed.input);await verifyQuoteCapture(allowed.input,crypto);
});

test('immutable binding pins canonical capture bytes, registered source and recorded clocks',async()=>{
 for(const change of [i=>i.binding.sourceConfigDigest='1'.repeat(64),i=>{i.binding.envelopeByteDigest='1'.repeat(64);i.binding.objectRef='private/'+i.binding.envelopeByteDigest+'.json';},
  i=>i.binding.contextSlot='999',i=>i.binding.blockTimeMs--,i=>i.binding.retrievedAtMs--,i=>i.binding.objectRef='public/forbidden.json']){
  const {input}=await fixture();change(input);await assert.rejects(()=>verifyQuoteCapture(input,crypto),code('evidence_binding'));
 }
 const {input}=await fixture();input.capture.untrusted='ignored';await assert.rejects(()=>verifyQuoteCapture(input,crypto),code('invalid_capture'));
});

test('activation fee boundaries0/88/89/90, dust, overflow, unsupported pool and vault balance retain existing math behavior',async()=>{
 for(const seconds of [0,88,89,90]){
  const {input,request}=await fixture(),activation=at-seconds*1000,bytes=Uint8Array.from(atob(input.capture.accounts.pool.data),c=>c.charCodeAt(0));
  new DataView(bytes.buffer).setBigUint64(472,BigInt(activation/1000),true);input.capture.accounts.pool.data=btoa(String.fromCharCode(...bytes));input.market.activationMs=activation;await rebind(input);
  const verified=await verifyQuoteCapture(input,crypto),quote=await evaluateVerifiedQuote({input:verified,request,evaluatedAtMs:at},crypto);assert.equal(quote.feeBps,Math.max(100,9000-seconds*100));
  assert.equal(Date.parse(quote.expiresAt),at+(seconds<89?1000:15000));
 }
 const {input,request}=await fixture(),verified=await verifyQuoteCapture(input,crypto);
 await assert.rejects(()=>evaluateVerifiedQuote({input:verified,request:{...request,inputUnits:'1'},evaluatedAtMs:at},crypto),code('dust_input'));
 await assert.rejects(()=>evaluateVerifiedQuote({input:verified,request:{...request,inputUnits:String(1n<<64n)},evaluatedAtMs:at},crypto),code('overflow'));
 await assert.rejects(()=>evaluateVerifiedQuote({input:verified,request,evaluatedAtMs:at-1},crypto),code('invalid_time'));
 const raw=Uint8Array.from(atob(input.capture.accounts.attVault.data),c=>c.charCodeAt(0));new DataView(raw.buffer).setBigUint64(64,1n,true);input.capture.accounts.attVault.data=btoa(String.fromCharCode(...raw));await rebind(input);
 await assert.rejects(async()=>evaluateVerifiedQuote({input:await verifyQuoteCapture(input,crypto),request,evaluatedAtMs:at},crypto),code('insufficient_vault'));
 const bad=await fixture(),pool=Uint8Array.from(atob(bad.input.capture.accounts.pool.data),c=>c.charCodeAt(0));pool[56]=1;bad.input.capture.accounts.pool.data=btoa(String.fromCharCode(...pool));await rebind(bad.input);await assert.rejects(()=>verifyQuoteCapture(bad.input,crypto),code('unsupported_pool'));
 const future=await fixture(),futurePool=Uint8Array.from(atob(future.input.capture.accounts.pool.data),c=>c.charCodeAt(0));new DataView(futurePool.buffer).setBigUint64(472,BigInt((at+1000)/1000),true);
 future.input.capture.accounts.pool.data=btoa(String.fromCharCode(...futurePool));future.input.market.activationMs=at+1000;await rebind(future.input);
 await assert.rejects(async()=>evaluateVerifiedQuote({input:await verifyQuoteCapture(future.input,crypto),request,evaluatedAtMs:at},crypto),code('preactivation'));
});

test('verification captures nested inputs before async crypto',async()=>{
 const {input,request}=await fixture(),baseline=await verifyQuoteCapture(input,crypto);let changed=false;
 const delayed={...crypto,async sha256(bytes){if(!changed){changed=true;input.capture.oracle.priceMicros='1';input.binding.receiptDigest='0'.repeat(64);input.source.policy.approvedOgFeed='changed';}return crypto.sha256(bytes);}};
 assert.deepEqual(await verifyQuoteCapture(input,delayed),baseline);
 const dto=structuredClone(baseline),expected=await evaluateVerifiedQuote({input:dto,request,evaluatedAtMs:at},crypto);changed=false;
 const mutate={...crypto,async sha256(bytes){if(!changed){changed=true;dto.data.pool.sqrtPriceX64='1';request.inputUnits='1';}return crypto.sha256(bytes);}};
 assert.deepEqual(await evaluateVerifiedQuote({input:dto,request,evaluatedAtMs:at},mutate),expected);
});
