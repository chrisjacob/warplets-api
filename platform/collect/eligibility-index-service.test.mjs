import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createEligibilityIndexService,prepareEligibilityIndexCommand} from './eligibility-index-service.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-indexer'},id='a'.repeat(64);
test('private page-index command binds identity/actor/key/revisions and excludes only the retry clock',async()=>{
 const input={principal,input:{id},requestKey:'stable',expectedRevisions:{source:'10'},nowMs:10},a=await prepareEligibilityIndexCommand(input,crypto),b=await prepareEligibilityIndexCommand({...input,nowMs:20},crypto);
 assert.equal(a.requestDigest,b.requestDigest);assert.equal(a.businessIdentity,id);assert.ok(Object.isFrozen(a.input));
 for(const change of [{principal:{kind:'operator',id:'other'}},{requestKey:'other'},{input:{id:'b'.repeat(64)}},{expectedRevisions:{source:'11'}}])assert.notEqual((await prepareEligibilityIndexCommand({...input,...change},crypto)).requestDigest,a.requestDigest);
 await assert.rejects(prepareEligibilityIndexCommand({...input,input:{id,entries:[]}},crypto));await assert.rejects(prepareEligibilityIndexCommand({...input,principal:{kind:'wallet',wallet:'unknown'}},crypto));await assert.rejects(prepareEligibilityIndexCommand({...input,expectedRevisions:{untrusted:'1'}},crypto));
});
test('service captures caller data before hashing and accepts no caller-supplied membership list',async()=>{
 const actor=structuredClone(principal),input={id,requestKey:'stable',expectedRevisions:{source:'1'}},received=[];
 const service=createEligibilityIndexService({clock:{nowMs:()=>12},crypto:{...crypto,async sha256(bytes){actor.id='changed';input.id='b'.repeat(64);input.requestKey='changed';input.expectedRevisions.source='99';return crypto.sha256(bytes);}},repository:{async materializePage(command){received.push(command);return {kind:'pending',reason:'synthetic',dependencyIds:[]};}}});
 await service.materializePage(actor,input);assert.equal(received[0].principal.id,principal.id);assert.equal(received[0].input.id,id);assert.equal(received[0].requestKey,'stable');assert.equal(received[0].expectedRevisions.source,'1');
 await assert.rejects(service.materializePage(principal,{id,requestKey:'other',entries:['untrusted']}));assert.equal(received.length,1);
});
