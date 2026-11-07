import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCompatibilityMatrix,compatibilityForFeature} from './matrix.mjs';
import * as harness from './harness.mjs';
import {unsignedCompatibilityFixture,marketplaceCompatibilityFixture,COMPATIBILITY_PACKET_SOURCES} from './fixtures.mjs';
const crypto=createNodeCrypto(),nowMs=1800000000000;
const row=(feature='message-auth')=>({configurationId:'synthetic-wallet-browser',surface:'wallet',name:'Synthetic Wallet Standard provider',version:'fixture-v1',browser:'synthetic-browser',browserVersion:'1',os:'synthetic-os',osVersion:'1',assetStandard:null,feature,status:'passed-local',evidenceType:feature==='unsigned-packet'?'recorded-packet':'local-browser',source:{...COMPATIBILITY_PACKET_SOURCES[0],recordedAtMs:nowMs},limitations:['Synthetic local coverage only; no physical signing or marketplace support.']});
test('separate feature evidence cannot promote fixture coverage to physical or venue support',async()=>{
 const records=[row(),{...row('unsigned-packet'),status:'incompatible'}],matrix=await createCompatibilityMatrix(records,{crypto,nowMs});assert.equal(compatibilityForFeature(matrix,records[0].configurationId,'message-auth').localActionAvailable,true);assert.equal(compatibilityForFeature(matrix,records[0].configurationId,'unsigned-packet').localActionAvailable,false);assert.equal(compatibilityForFeature(matrix,records[0].configurationId,'physical-signing-return').status,'untested');assert.equal(matrix.physicalSupportVerified,false);assert.equal(matrix.financialExecution,false);
 for(const feature of ['physical-signing-return','nft-transfer','listing','fill','cancel','royalties'])await assert.rejects(createCompatibilityMatrix([{...row(feature),evidenceType:'recorded-protocol'}],{crypto,nowMs}),/cannot establish/);
});
test('stale, future, absent or incomplete configuration evidence stays unverified',async()=>{
 for(const patch of [{source:{...row().source,recordedAtMs:nowMs-1001}},{source:{...row().source,recordedAtMs:nowMs+1}},{version:null},{browserVersion:null}])assert.equal((await createCompatibilityMatrix([{...row(),...patch}],{crypto,nowMs,maxAgeMs:1000})).rows[0].effectiveStatus,'untested');
 const missing={...row(),status:'untested',source:null,evidenceType:'missing'};assert.equal((await createCompatibilityMatrix([missing],{crypto,nowMs})).rows[0].localCoverage,false);
 await assert.rejects(createCompatibilityMatrix([row(),row()],{crypto,nowMs}));let reads=0;const bad=row();Object.defineProperty(bad,'source',{get(){reads++;return row().source;},enumerable:true});await assert.rejects(createCompatibilityMatrix([bad],{crypto,nowMs}));assert.equal(reads,0);
 await assert.rejects(createCompatibilityMatrix([row(),{...row('unsigned-packet'),version:'other-version'}],{crypto,nowMs}),/configuration identity/);
});
test('B15 legacy and derived unsigned v0 packets retain exact plan, signer and account verification',async()=>{
 for(const version of ['legacy',0]){const f=unsignedCompatibilityFixture({version}),r=await harness.inspectUnsignedWalletPacket(f,{crypto});assert.equal(r.status,'passed-local');assert.equal(r.transactionVersion,version);assert.deepEqual(r.expectedSigners,f.intent.plan.signers);assert.equal(r.accountCount,2);assert.ok(r.serializedBytes<=1232);assert.equal(r.physicalSigningVerified,false);assert.equal(r.isAuthorization,false);}
 assert.deepEqual(Object.keys(harness).sort(),['describeMarketplaceFixture','inspectUnsignedWalletPacket']);
});
test('unsupported wallet capability affects only packet preparation and never provides a signer',async()=>{
 const f=unsignedCompatibilityFixture({version:0});for(const patch of [{transactionVersions:['legacy']},{maxSerializedBytes:100},{maxAccounts:1},{displayedSigners:[]}]){const r=await harness.inspectUnsignedWalletPacket({...f,capabilities:{...f.capabilities,...patch}},{crypto});assert.equal(r.status,'incompatible');assert.equal(r.financialExecution,false);assert.ok(r.reasons.length);}
});
test('packet/plan/intent substitution, unapproved account reference and stale lifetime reject',async()=>{
 const f=unsignedCompatibilityFixture();for(const mutate of [v=>v.expectedIntentId='other',v=>v.intent.plan.subject='other',v=>v.packet.messageHash='0'.repeat(64),v=>v.packet.lookupTables=[{}],v=>v.nowMs+=60001,v=>v.capabilities.signTransaction='unexpected']){const v=structuredClone(f);mutate(v);await assert.rejects(harness.inspectUnsignedWalletPacket(v,{crypto}));}
 const v=structuredClone(f),bytes=Buffer.from(v.packet.messageBase64,'base64');bytes[bytes.length-1]=2;v.packet.messageBase64=bytes.toString('base64');v.packet.messageHash=createHash('sha256').update(bytes).digest('hex');await assert.rejects(harness.inspectUnsignedWalletPacket(v,{crypto}),/instruction differs/);
 const badReference=structuredClone(f),wire=Buffer.from(badReference.packet.messageBase64,'base64');wire[wire.length-4]=2;badReference.packet.messageBase64=wire.toString('base64');badReference.packet.messageHash=createHash('sha256').update(wire).digest('hex');await assert.rejects(harness.inspectUnsignedWalletPacket(badReference,{crypto}),/unknown account/);
 const oversized=structuredClone(f),large=Buffer.alloc(1233);oversized.packet.messageBase64=large.toString('base64');oversized.packet.messageHash=createHash('sha256').update(large).digest('hex');await assert.rejects(harness.inspectUnsignedWalletPacket(oversized,{crypto}),/message encoding/);
});
test('input mutations during asynchronous plan hashing cannot change the captured packet review',async()=>{
 const f=unsignedCompatibilityFixture(),expectedHash=f.packet.messageHash;let changed=false;
 const wrapped={...crypto,async sha256(bytes){if(!changed){changed=true;f.packet.messageHash='0'.repeat(64);f.intent.plan.subject='substituted';f.capabilities.displayedSigners.length=0;}return crypto.sha256(bytes);}};
 const result=await harness.inspectUnsignedWalletPacket(f,{crypto:wrapped});assert.equal(result.status,'passed-local');assert.equal(result.messageHash,expectedHash);assert.equal(result.expectedSigners.length,1);
});
test('marketplace unknowns remain unknown and stale recorded price never creates a trade CTA',()=>{
 const f=marketplaceCompatibilityFixture(nowMs),view=harness.describeMarketplaceFixture(f,{nowMs});assert.equal(view.listing.priceUnits,null);assert.equal(view.royalty.targetBps,null);assert.equal(view.remainingVaultUnits,null);assert.equal(view.royaltyRealizationUnits,null);assert.equal(view.nativeTradeAvailable,false);assert.equal(view.currentClaimAuthorityVerified,false);
 const stale=harness.describeMarketplaceFixture({...f,listing:{state:'listed',priceUnits:'100',currency:'SOL-lamports',observedMs:nowMs-60001}},{nowMs});assert.equal(stale.priceFresh,false);assert.equal(stale.nativeTradeAvailable,false);assert.throws(()=>harness.describeMarketplaceFixture({...f,royalty:{...f.royalty,enforcement:'guaranteed'}},{nowMs}));
});
test('retained B15 vector and verifier sources match their pinned source identities',async()=>{
 for(const source of COMPATIBILITY_PACKET_SOURCES){const bytes=await readFile(new URL('../../'+source.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),source.digest);assert.match(source.commit,/^[a-f0-9]{40}$/);}
});
