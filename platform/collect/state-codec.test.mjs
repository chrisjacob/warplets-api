import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createInventory,publishStage,admitMint,applyVerifiedMintDraw} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const crypto={sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')},codec=createCollectionStateCodec({crypto});
const clean=value=>JSON.parse(JSON.stringify(value,(_key,value)=>typeof value==='bigint'?{$lamports:value.toString()}:value));
function source({stageCount=2,memberCount=4,admissionCount=3}={}){
 const wallets=Array.from({length:memberCount},(_,i)=>{const bytes=Buffer.alloc(32,127);bytes.writeUInt32BE(i,28);return encode58(bytes);}).sort();
 let state=createInventory({id:'synthetic-codec',kind:'genesis',tranche:1});
 for(let n=0;n<stageCount;n++)state=publishStage(state,{id:'stage-'+n,type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets,walletLimit:1});
 for(let n=0;n<admissionCount;n++)state=admitMint(state,{operationId:'op-'+n,wallet:wallets[n],stageId:'stage-0',at:180000000,drawCommitment:'commit-'+n,costLamports:5000n});
 return state;
}
test('paged source preserves reference values and deduplicates identical immutable stage lists',async()=>{
 const state=source(),before=canonicalJson(clean(state)),bundle=await codec.encodeReferenceInventory(state),roundtrip=await codec.decodeReferenceInventory(bundle);
 assert.equal(canonicalJson(clean(roundtrip)),before);assert.equal(canonicalJson(clean(state)),before);
 assert.equal(bundle.listManifests.length,1);assert.equal(bundle.pages.length,2);assert.ok(bundle.root.size<4096);
 const root=await codec.verifyRecord(bundle.root);assert.equal(root.source.stateDigest,await crypto.sha256(utf8(before)));assert.equal(root.admissions.count,3);
 const second=await codec.encodeReferenceInventory(state);assert.equal(second.root.id,bundle.root.id);
});
test('missing/tampered/reordered page commitments and altered source counts cannot verify',async()=>{
 const bundle=await codec.encodeReferenceInventory(source({memberCount:101,admissionCount:101}));
 const missing=structuredClone(bundle);missing.pages.pop();await assert.rejects(codec.decodeReferenceInventory(missing),/Missing/);
 const changed=structuredClone(bundle);changed.pages[0].bytes[5]^=1;await assert.rejects(codec.decodeReferenceInventory(changed),/digest mismatch/);
 const root=await codec.verifyRecord(bundle.root);root.admissions.count++;
 const bytes=utf8(canonicalJson(root)),bad={...bundle,root:{bytes,size:bytes.byteLength,id:await crypto.sha256(bytes)}};await assert.rejects(codec.decodeReferenceInventory(bad),/Admission count/);
 const shuffled=await codec.verifyRecord(bundle.listManifests[0]);shuffled.pageIds.reverse();const listBytes=utf8(canonicalJson(shuffled)),list={id:await crypto.sha256(listBytes),bytes:listBytes,size:listBytes.byteLength};
 const root2=await codec.verifyRecord(bundle.root);for(const stage of root2.stages)stage.eligibility.manifestId=list.id;const rootBytes=utf8(canonicalJson(root2));
 await assert.rejects(codec.decodeReferenceInventory({...bundle,listManifests:[list],root:{id:await crypto.sha256(rootBytes),bytes:rootBytes,size:rootBytes.byteLength}}),/reordered/);
});
test('input is captured before asynchronous hashing and noncanonical membership is rejected',async()=>{
 const state=structuredClone(source());let first=true;const slow=createCollectionStateCodec({crypto:{sha256:async bytes=>{if(first){first=false;state.stages[0].wallets[0]='bad';state.id='changed';}return crypto.sha256(bytes);}}});
 const captured=await slow.encodeReferenceInventory(state),restored=await codec.decodeReferenceInventory(captured);assert.equal(restored.id,'synthetic-codec');assert.notEqual(restored.stages[0].wallets[0],'bad');
 await assert.rejects(codec.encodeReferenceInventory(state),/canonical/);
 const duplicate=structuredClone(source());duplicate.stages[0].wallets.push(duplicate.stages[0].wallets[0]);await assert.rejects(codec.encodeReferenceInventory(duplicate),/unique/);
});
test('all legal 32 stages, 10000 members and 1000 admissions are retained in bounded records',async()=>{
 const state=source({stageCount:32,memberCount:10000,admissionCount:1000}),bundle=await codec.encodeReferenceInventory(state);
 assert.equal(bundle.listManifests.length,1);assert.equal(bundle.pages.length,110);assert.ok(bundle.root.size<=65536);assert.ok(bundle.listManifests.every(row=>row.size<=16384));assert.ok(bundle.pages.every(row=>row.size<=65536));
 const restored=await codec.decodeReferenceInventory(bundle);assert.equal(restored.stages.length,32);assert.ok(restored.stages.every(stage=>stage.wallets.length===10000));assert.equal(restored.admissions.length,1000);assert.equal(canonicalJson(clean(restored)),canonicalJson(clean(state)));
});
test('settled maximum-length admission identities split by bytes without losing proof or draw ordering',async()=>{
 let state=structuredClone(source({stageCount:1,memberCount:1000,admissionCount:1000}));
 const stageId='s'.repeat(128);state.stages[0].id=stageId;
 state.admissions=state.admissions.map((row,index)=>({...row,stageId,operationId:String(index).padStart(4,'0')+'o'.repeat(124),drawCommitment:String(index).padStart(4,'0')+'c'.repeat(124),costLamports:(1n<<64n)-1n}));
 for(const [index,row] of state.admissions.entries())state=applyVerifiedMintDraw(state,{operationId:row.operationId,drawCommitment:row.drawCommitment,proofId:String(index).padStart(4,'0')+'p'.repeat(124),ticket:0});
 const bundle=await codec.encodeReferenceInventory(state),root=await codec.verifyRecord(bundle.root);assert.ok(root.admissions.pageIds.length>10);assert.ok(root.admissions.pageIds.length<=16);assert.ok(bundle.pages.every(row=>row.size<=65536));
 const restored=await codec.decodeReferenceInventory(bundle);assert.equal(restored.fulfilled,1000);assert.equal(canonicalJson(clean(restored)),canonicalJson(clean(state)));
});
test('maximum published Unicode rationales remain legal in the compact root without truncation',async()=>{
 const state=structuredClone(source({stageCount:32,memberCount:1,admissionCount:0}));
 state.stages=state.stages.map((stage,index)=>({...stage,id:String(index).padStart(3,'0')+'s'.repeat(125),priceLamports:index===0?100000000n:(1n<<64n)-1n,costLamports:(1n<<64n)-1n,approvedSpendLamports:(1n<<64n)-1n,termsDigest:'a'.repeat(64),ballotId:'b'.repeat(128),inventoryOverrideReason:'漢'.repeat(500)}));
 const bundle=await codec.encodeReferenceInventory(state);assert.ok(bundle.root.size>65536);assert.ok(bundle.root.size<=131072);
 const restored=await codec.decodeReferenceInventory(bundle);assert.equal(canonicalJson(clean(restored)),canonicalJson(clean(state)));
});
