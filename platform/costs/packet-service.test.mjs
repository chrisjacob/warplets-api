import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {costPacket,executionContextId} from './packet.mjs';
import {executionContextPreimage} from './packet-core.mjs';
import {createCostPacketService} from './packet-service.mjs';
import {costPacketFixtures} from './packet.fixtures.mjs';
const crypto=createNodeCrypto(),service=createCostPacketService({crypto});
// Independently generated using git HEAD's original synchronous packet.mjs,
// before this extraction, with the exact unchanged fixture input/transcript.
const legacyHashes={reference:'43117dfcfb734f71750a4fb4ada9ec71c2fa1dd3c7e26da1637ff3193c9f734e',complete:'bddc57ae4784d5f28d0e9bcc2d49e175da95bc22da1c303b4f2b0f712c794113',stale:'56a066f3068af7a25c287a657fc4d408ed932cd3c8e38a267102574f78e1b640',changed:'83ecb7be737b3f6375629e5b7bf4c638d918a1eec9b1473462578bf457d7c868',unknown:'1861dd7e3127e89e324ee7ac4fce2dc774cb048d67e14f9255c51f6d86a280db',zero:'0362688aab7bb5ed4b07fc5ef2429e3edc3e9ad1c69da6afd2a1c60dba53ec6d'};
test('portable calculator preserves exact original fourteen-scenario outputs and ordered context preimage',async()=>{
 for(const [name,input]of Object.entries(costPacketFixtures())){const sync=costPacket(input),portable=await service.calculate(input);assert.deepEqual(portable,sync);assert.equal(createHash('sha256').update(JSON.stringify(portable)).digest('hex'),legacyHashes[name],name);assert.equal(portable.scenarios.length,14);assert.equal(portable.mode,'planning-only');}
 const context=costPacketFixtures().complete.context,expected=JSON.stringify(['local-test','101','synthetic-instructions','synthetic-programs','synthetic-funding','synthetic-block','synthetic-recording',context.validUntilMs,'synthetic-OG']);assert.equal(executionContextPreimage(context),expected);assert.equal(executionContextId(context),'ef38e736a20a6d86007ee490c66ae8fa349e3ba908a2f71d169ba8b0a2e0641b');assert.equal(executionContextPreimage({}),JSON.stringify(Array(9).fill(null)));
});
test('all inputs are copied before async hash and caller context IDs cannot grant a matching quote context',async()=>{
 const input=costPacketFixtures().complete,expected=structuredClone(costPacket(input));let release,entered;const gate=new Promise(r=>release=r),start=new Promise(r=>entered=r),pending=createCostPacketService({crypto:{async sha256(bytes){entered();await gate;return crypto.sha256(bytes);}}}).calculate(input);await start;input.context.fundingStateHash='mutated';input.quotes.mintRent.amount='999';input.parameters.seasonPaid=1;input.fx.sol.microUsdPerWhole='1';release();assert.deepEqual(await pending,expected);
 const spoof=costPacketFixtures().complete;spoof.context.fundingStateHash='changed';spoof.contextId=executionContextId(costPacketFixtures().complete.context);spoof.executionContextId=spoof.contextId;spoof.computedContextId=spoof.contextId;const result=await service.calculate(spoof);assert.notEqual(result.executionContextId,spoof.contextId);assert.equal(result.firstAtt.status,'incomplete');assert.ok(result.firstAtt.lines.some(l=>l.problems.includes('quote context changed or unbound')));
});
test('bounded portable plain data rejects getters/cycles/oversize and malformed crypto; legacy errors remain',async()=>{
 let getter=false;const input={asOfMs:1};Object.defineProperty(input,'context',{enumerable:true,get(){getter=true;return {};}});await assert.rejects(service.calculate(input),/data fields/);assert.equal(getter,false);const cyclic={asOfMs:1};cyclic.extra=cyclic;await assert.rejects(service.calculate(cyclic),/acyclic/);await assert.rejects(service.calculate({asOfMs:1,extra:'x'.repeat(262145)}),/byte bound/);await assert.rejects(createCostPacketService({crypto:{sha256:async()=> 'forged'}}).calculate({asOfMs:1}),/context digest/);
 for(const input of [null,{asOfMs:-1},{asOfMs:1,parameters:{unknown:1}},{asOfMs:1,quotes:{unknown:{}}}]){assert.throws(()=>costPacket(input));await assert.rejects(service.calculate(input));}
});
