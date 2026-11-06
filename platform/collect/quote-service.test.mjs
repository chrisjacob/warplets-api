import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {buildCollectionQuoteCommand,createCollectionQuoteService} from './quote-service.mjs';
const crypto=createNodeCrypto(),wallet=encode58(new Uint8Array(32).fill(7));
const input=()=>({requestKey:'synthetic-request',kind:'upgrade',inventoryId:'synthetic-season',targetId:'target',materialId:'material',expectedTargetVersion:1,expectedMaterialVersion:2});
test('quote request identity binds caller-reviewed fields and excludes server-generated clock and identities',async()=>{
 const p={kind:'wallet',wallet},first=await buildCollectionQuoteCommand(p,input(),crypto),same=await buildCollectionQuoteCommand(p,{...input(),maxTotalLamports:null},crypto);assert.deepEqual(same,first);assert.ok(Object.isFrozen(first.input));
 for(const patch of [{maxTotalLamports:'10000000'},{expectedTargetVersion:2},{materialId:'other'},{requestKey:'another'}])assert.notEqual((await buildCollectionQuoteCommand(p,{...input(),...patch},crypto)).requestDigest,first.requestDigest);
 for(const patch of [{quoteId:'caller-authority'},{nowMs:0},{expiresMs:1},{policyVersion:'caller-policy'},{sourceDigest:'a'.repeat(64)},{instructions:[]},{materialId:'target'},{maxTotalLamports:'01'}])await assert.rejects(buildCollectionQuoteCommand(p,{...input(),...patch},crypto));
});
test('caller mutation during request hashing cannot replace principal, expected versions or fee ceiling',async()=>{
 const p={kind:'wallet',wallet},value=input();let changed=false,captured;
 const service=createCollectionQuoteService({repository:{async issueQuote(command){captured=command;return {kind:'pending',reason:'test-only',dependencyIds:[]};}},crypto:{...crypto,async sha256(bytes){if(!changed){changed=true;p.wallet='bad';value.targetId='changed';value.maxTotalLamports='0';}return crypto.sha256(bytes);}}});
 await service.issueQuote(p,value);assert.equal(captured.principal.wallet,wallet);assert.equal(captured.input.targetId,'target');assert.equal(captured.input.maxTotalLamports,null);assert.equal(captured.input.expectedTargetVersion,1);
});
