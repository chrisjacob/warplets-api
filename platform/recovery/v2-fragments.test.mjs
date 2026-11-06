import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createRecoveryV2FragmentCodec,recoveryFragmentCharacters,recoveryFragmentDescriptor,RECOVERY_FRAGMENT_COLUMNS} from './v2-fragments.mjs';
const crypto=createNodeCrypto(),codec=createRecoveryV2FragmentCodec({crypto});
async function descriptor(){const pieces=['["'+('界😀\\\"\n'.repeat(2000)), 'final"]'],text=pieces.join(''),characters=Array.from(text),chunks=[];for(let i=0;i<characters.length;i+=8192)chunks.push(await codec.encodeChunk(characters.slice(i,i+8192).join('')));return {format:'10x.local.recovery.fragmented-row.v2',table:'fair_inventories',schemaFingerprint:'a'.repeat(64),index:0,columns:[...RECOVERY_FRAGMENT_COLUMNS],hasRowid:true,after:null,cursor:[1],encoding:'sqlite-json-array-text-utf8-v1',characters:characters.length,bytes:Buffer.byteLength(text),fragments:chunks.map((c,index)=>({index,offset:index*8192+1,characters:c.characters,identity:c.identity}))};}
test('fragment codec retains exact UTF-8 bytes and SQLite Unicode counts across escape boundaries',async()=>{
 const text='界😀\\\"\n'.repeat(1000),encoded=await codec.encodeChunk(text);assert.equal(encoded.characters,5000);assert.equal(recoveryFragmentCharacters(text),5000);assert.equal((await codec.verifyChunk(encoded.bytes,encoded.identity,5000)).text,text);assert.equal(encoded.identity.contentType,'application/octet-stream');const value=await descriptor(),object=await codec.encodeRowDescriptor(value);assert.deepEqual(await codec.verifyRowDescriptor(object.bytes,object.identity),value);assert.ok(Object.isFrozen(object.value.fragments));
});
test('descriptor rejects wrong table/schema/order/prefix/totals and supports repeated identical byte chunks',async()=>{
 const value=await descriptor();for(const mutate of [v=>v.table='app_jobs',v=>v.schemaFingerprint='x',v=>v.columns.reverse(),v=>v.fragments[0].offset=2,v=>v.fragments[0].index=1,v=>v.fragments.reverse(),v=>v.fragments.pop(),v=>v.characters++,v=>v.bytes++,v=>v.fragments[0].identity.semanticDigest='b'.repeat(64),v=>v.extra=true]){const bad=structuredClone(value);mutate(bad);assert.throws(()=>recoveryFragmentDescriptor(bad),/Recovery fragment/);}
 const chunk=await codec.encodeChunk('a'.repeat(8192)),repeated={...value,characters:16384,bytes:16384,fragments:[0,1].map(index=>({index,offset:1+index*8192,characters:8192,identity:chunk.identity}))};assert.equal(recoveryFragmentDescriptor(repeated).fragments.length,2);
});
test('chunk codec rejects byte corruption, invalid UTF-8, nulls, surrogate loss and out-of-bound content',async()=>{
 const c=await codec.encodeChunk('exact');await assert.rejects(codec.verifyChunk(Uint8Array.from([1,2,3,4,5]),c.identity),/digest/);await assert.rejects(codec.verifyChunk(c.bytes,c.identity,4),/character/);for(const value of ['','\0','\ud800','\udc00','x'.repeat(8193)])await assert.rejects(codec.encodeChunk(value),/Recovery fragment/);
 const bytes=Uint8Array.from([0xc0,0xaf]),byteDigest=await crypto.sha256(bytes);await assert.rejects(codec.verifyChunk(bytes,{key:'private/'+byteDigest+'.bin',byteDigest,size:2,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'}));
});
test('descriptor and verification identities are captured before asynchronous digest awaits',async()=>{
 const value=structuredClone(await descriptor());let mutate;const delayed=createRecoveryV2FragmentCodec({crypto:{...crypto,async sha256(bytes){mutate?.();return crypto.sha256(bytes);}}});mutate=()=>{value.table='app_jobs';value.fragments[0].identity.byteDigest='b'.repeat(64);};const encoded=await delayed.encodeRowDescriptor(value);assert.equal(encoded.value.table,'fair_inventories');const identity=structuredClone(encoded.identity),bytes=new Uint8Array(encoded.bytes);mutate=()=>{identity.byteDigest='c'.repeat(64);bytes.fill(0);};assert.equal((await delayed.verifyRowDescriptor(bytes,identity)).table,'fair_inventories');
});
