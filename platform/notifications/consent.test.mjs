import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {NOTICE_TERMS,normalizeNotificationConsentInput,buildNotificationConsentCommand,createNotificationConsentService} from './consent.mjs';
const principal={kind:'wallet',wallet:encode58(new Uint8Array(32).fill(9))},crypto=createNodeCrypto(),input={channel:'local-inbox',enabled:true,topics:['rewards','launch'],terms:NOTICE_TERMS,expectedRevision:0},value=()=>({principal,requestKey:'synthetic-consent',input,nowMs:1000});
test('portable consent preserves exact legacy ordered digest while key/time remain independently bound',async()=>{
 const c=await buildNotificationConsentCommand(value(),crypto),expected=createHash('sha256').update(JSON.stringify(['local-inbox',true,['launch','rewards'],NOTICE_TERMS,0])).digest('hex');
 assert.equal(c.requestDigest,expected);assert.deepEqual(c.input.topics,['launch','rewards']);assert.equal(c.businessIdentity,JSON.stringify([principal.wallet,'local-inbox','synthetic-consent']));assert.equal(Object.isFrozen(c.input.topics),true);
 const retry=await buildNotificationConsentCommand({...value(),nowMs:2000,requestKey:'another-key',input:{...input,topics:['launch','rewards']}},crypto);assert.equal(retry.requestDigest,c.requestDigest);assert.notEqual(retry.businessIdentity,c.businessIdentity);
});
test('exact owner consent fields and safe revision fail closed',async()=>{
 for(const patch of [{wallet:principal.wallet},{enabled:false},{topics:['launch','launch']},{topics:['email']},{terms:'changed'},{channel:'email'},{expectedRevision:-1},{expectedRevision:Number.MAX_SAFE_INTEGER}])assert.throws(()=>normalizeNotificationConsentInput({...input,...patch}),TypeError);
 for(const p of [{kind:'operator',id:'founder'},{...principal,role:'owner'},{kind:'wallet',wallet:'holder'}])await assert.rejects(buildNotificationConsentCommand({...value(),principal:p},crypto));
 await assert.rejects(buildNotificationConsentCommand({...value(),requestKey:' bad'},crypto));await assert.rejects(buildNotificationConsentCommand({...value(),expectedRevisions:{}},crypto));
 assert.deepEqual(normalizeNotificationConsentInput({...input,enabled:false,topics:[]}).topics,[]);
});
test('caller mutation across hash cannot change command or service identity',async()=>{
 const v=structuredClone(value()),port={...crypto,async sha256(bytes){v.principal.wallet=encode58(new Uint8Array(32).fill(8));v.input.enabled=false;v.input.topics=[];v.requestKey='changed';return crypto.sha256(bytes);}},expected=await buildNotificationConsentCommand(value(),crypto),actual=await buildNotificationConsentCommand(v,port);assert.deepEqual(actual,expected);
 let received;const service=createNotificationConsentService({crypto,clock:{nowMs:()=>1000},repository:{setConsent:async c=>{received=c;return {kind:'pending',reason:'synthetic',dependencyIds:[]};},readPreferences:async p=>p}});
 await service.setConsent(principal,{requestKey:'synthetic-consent',input});assert.deepEqual(received,expected);await assert.rejects(service.setConsent(principal,{requestKey:'synthetic-consent',input,wallet:principal.wallet}));
});
