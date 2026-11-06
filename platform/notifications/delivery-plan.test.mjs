import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {NOTICE_TERMS} from './consent.mjs';
import {buildEnqueueNoticeCommand,prepareNoticeSource} from './delivery-plan.mjs';
const crypto=createNodeCrypto(),wallet=encode58(new Uint8Array(32).fill(9)),principal={kind:'operator',id:'synthetic-notice-worker'},now=Date.UTC(2026,10,7,12),DAY=86400000;
test('portable notice IDs and all three fixed source templates preserve legacy event identities',async()=>{
 const cases=[{input:{wallet,topic:'launch',subject:'synthetic market'},facts:{body:JSON.stringify({activatedAt:new Date(now).toISOString()})},target:'/markets/synthetic%20market',expires:now+DAY,key:'synthetic market'},
 {input:{wallet,topic:'voting',subject:'synthetic-ballot'},facts:{id:'synthetic-ballot',opensMs:now,closesMs:now+1000},target:'/collections/genesis',expires:now+1000,key:'synthetic-ballot'},
 {input:{wallet,topic:'rewards',subject:{tokenId:'synthetic-token',day:1}},facts:{amount:'10',epoch:Math.floor(now/DAY),vestsFromMs:now-1,vestsThroughMs:now+1000},target:'/earn/2026-11-07',expires:now+1000+DAY,key:'["synthetic-token",1]'}];
 for(const row of cases){const command=await buildEnqueueNoticeCommand({principal,input:row.input,requestKey:'synthetic',nowMs:now},crypto),plan=await prepareNoticeSource(row.input,row.facts,now,crypto);assert.equal(command.businessIdentity,createHash('sha256').update(JSON.stringify([NOTICE_TERMS,wallet,row.input.topic,row.key])).digest('hex'));assert.equal(plan.kind,'ready');assert.equal(plan.target,row.target);assert.equal(plan.expiresMs,row.expires);assert.equal((await prepareNoticeSource(row.input,row.facts,row.expires,crypto)).kind,'skipped');}
});
test('source clocks, zero awards, missing facts, arbitrary message fields and caller mutation fail safely',async()=>{
 const input={wallet,topic:'launch',subject:'synthetic'},facts={body:JSON.stringify({activatedAt:new Date(now+1).toISOString()})};assert.equal((await prepareNoticeSource(input,facts,now,crypto)).kind,'skipped');assert.equal((await prepareNoticeSource(input,null,now,crypto)).kind,'skipped');await assert.rejects(prepareNoticeSource({...input,message:'injected'},facts,now,crypto));await assert.rejects(prepareNoticeSource(input,{body:'x'.repeat(65537)},now,crypto));
 const reward={wallet,topic:'rewards',subject:{tokenId:'T',day:1}},zero={amount:'0',epoch:1,vestsFromMs:now-1,vestsThroughMs:now};assert.equal((await prepareNoticeSource(reward,zero,now,crypto)).kind,'skipped');
 const raw={principal:{...principal},input:{...input},requestKey:'captured',nowMs:now},port={...crypto,async sha256(bytes){raw.input.subject='changed';raw.principal.id='changed';return crypto.sha256(bytes);}},command=await buildEnqueueNoticeCommand(raw,port);assert.equal(command.input.subject,'synthetic');assert.equal(command.principal.id,principal.id);
});
