import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {createNotificationConsentService,NOTICE_TERMS} from './consent.mjs';
import {handleNotificationConsent,portableNoticeCapabilities} from './consent-http.mjs';
import {randomUUID} from 'node:crypto';
const origin='http://localhost',base=origin+'/api/v1/notifications',wallet=encode58(new Uint8Array(32).fill(19)),other=encode58(new Uint8Array(32).fill(20));
const input={channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0};
function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const ports={crypto:createNodeCrypto(),clock:{nowMs:Date.now},ids:{next:randomUUID}};
 const service=createNotificationConsentService({...ports,repository:createNotificationConsentRepository(createNodeAtomicDriver(db),ports)});
 const consumeQuota=async()=>null,authenticate=async r=>{const who=r.headers.get('x-synthetic-wallet');return who?{kind:'wallet',wallet:who}:null;};
 const send=(path='/subscriptions',{body,method=body?'POST':'GET',key='synthetic-consent',who=wallet,headers={}}={})=>handleNotificationConsent(new Request(base+path,{method,headers:{origin,'content-type':'application/json','idempotency-key':key,...(who?{'x-synthetic-wallet':who}:{}),...headers},...(body?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),{service,authenticate,consumeQuota});
 return {db,send};
}
test('portable consent HTTP derives wallet, preserves revoked replay and private response policy',async t=>{
 const {db,send}=fixture(t),caps=await send('/capabilities',{who:null});assert.deepEqual(await caps.json(),portableNoticeCapabilities);
 const before=await send();assert.equal(before.headers.get('cache-control'),'no-store');assert.equal((await before.json()).enabled,false);
 const enabled=await send('/subscriptions',{body:input});assert.equal(enabled.status,200);assert.equal((await enabled.json()).appliedRevision,1);
 assert.equal((await (await send('/subscriptions',{who:other})).json()).enabled,false);
 const revoked=await send('/subscriptions',{key:'synthetic-revoke',body:{...input,enabled:false,topics:[],expectedRevision:1}});assert.equal(revoked.status,200);
 const count=db.prepare('SELECT total_changes() n').get().n,replay=await send('/subscriptions',{body:input});const result=await replay.json();assert.equal(result.replay,true);assert.equal(result.appliedRevision,1);assert.equal(result.preference.enabled,false);assert.equal(result.preference.revision,2);assert.equal(db.prepare('SELECT total_changes() n').get().n,count);
 assert.equal((await send('/subscriptions',{body:{...input,topics:['voting']}})).status,409);
 assert.equal((await send('/subscriptions',{key:'new-key',body:input})).status,409);
});
test('portable consent HTTP rejects unauthenticated, cross-origin, extra identity and oversized bodies without writes',async t=>{
 const {db,send}=fixture(t),before=db.prepare('SELECT total_changes() n').get().n;
 for(const [options,status] of [[{who:null},401],[{body:input,headers:{origin:'https://elsewhere.invalid'}},403],[{body:{...input,wallet:other}},400],[{body:{...input,topics:['launch','launch']}},400],[{body:input,key:'invalid key'},400],[{body:input,headers:{'content-type':'text/plain'}},415],[{body:'{broken'},400],[{body:' '.repeat(2049)},413],[{method:'DELETE'},405]])assert.equal((await send('/subscriptions',options)).status,status);
 assert.equal(await send('/inbox'),null);assert.equal((await send('/capabilities',{method:'POST',body:input})).status,405);assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
});
