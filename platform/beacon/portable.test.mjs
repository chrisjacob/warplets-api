import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {verifyPinnedBeacon} from './portable.mjs';
import {QUICKNET_PUBLIC_KEY,QUICKNET_DST,hexBytes} from './protocol.mjs';
import {materializeProgressionDraw,uniformDraw} from '../randomness/portable-draw.mjs';
import {uniform,materializeDraw} from '../randomness/selection.mjs';
import {uniformCandidate} from '../randomness/draw-protocol.mjs';
import {roundTime} from '../randomness/request-plan.mjs';
const proof=JSON.parse(readFileSync(new URL('./fixtures/round-30000000.json',import.meta.url))),crypto=createNodeCrypto();
test('portable beacon adapter binds exact retained bytes and pinned verifier parameters without pretending injection is a signature check',async()=>{
 let calls=0;const verifier={verifyShortSignature:async input=>{calls++;assert.deepEqual(input.signature,hexBytes(proof.signature));assert.deepEqual(input.publicKey,hexBytes(QUICKNET_PUBLIC_KEY));assert.equal(input.dst,QUICKNET_DST);assert.equal(input.message.length,32);return true;}};
 assert.equal(await verifyPinnedBeacon(proof,proof.round,crypto,verifier),proof.randomness);assert.equal(calls,1);
 for(const patch of [{chain:'wrong'},{round:proof.round+1},{randomness:'0'.repeat(64)},{signature:'0'.repeat(96)},{finalized:true}])await assert.rejects(verifyPinnedBeacon({...proof,...patch},proof.round,crypto,verifier));
 await assert.rejects(verifyPinnedBeacon(proof,proof.round,crypto,{verifyShortSignature:()=>false}),/signature verification failed/);await assert.rejects(verifyPinnedBeacon(proof,proof.round,crypto,null),/unavailable/);
 const mutable={...proof};let changed=false;assert.equal(await verifyPinnedBeacon(mutable,proof.round,{...crypto,async sha256(bytes){if(!changed){changed=true;mutable.signature='0'.repeat(96);mutable.randomness='0'.repeat(64);mutable.round++;}return crypto.sha256(bytes);}},verifier),proof.randomness);
});
test('portable uniform and progression materialization preserve all synchronous legacy hash preimages and outcomes',async()=>{
 const choices=Object.fromEntries(['model','backdrop','symbol'].map(k=>[k,[{name:'synthetic first',weight:2},{name:'synthetic second',weight:1}]])),request={target_round:proof.round,context_digest:'a'.repeat(64)},db={prepare:()=>({get:()=>({traits:JSON.stringify(choices)})})};
 for(const size of [1,3,489,1000,256000000])for(const label of ['upgrade-level','model'])assert.equal(await uniformDraw('synthetic-seed',label,size,crypto),uniform('synthetic-seed',label,size));
 assert.equal(uniformCandidate('f'.repeat(64),1000),null);assert.equal(uniformCandidate('0'.repeat(64),1000),0);
 for(const kind of ['upgrade','visual']){const operation={id:'synthetic-op',kind,commitment:'synthetic-commitment',inventory_id:'synthetic-inventory'},input={operation,request,randomness:proof.randomness,traitChoices:choices};assert.deepEqual(await materializeProgressionDraw(input,crypto),materializeDraw(db,operation,request,proof.randomness,roundTime(proof.round)));}
 const mutable={operation:{id:'synthetic-op',kind:'upgrade',commitment:'synthetic-commitment'},request:{...request},randomness:proof.randomness,traitChoices:{}};let changed=false;
 const result=await materializeProgressionDraw(mutable,{...crypto,async sha256(bytes){if(!changed){changed=true;mutable.operation.id='changed';mutable.request.context_digest='b'.repeat(64);}return crypto.sha256(bytes);}});assert.equal(result.operationId,'synthetic-op');
});
