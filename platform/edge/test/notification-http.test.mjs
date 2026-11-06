import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {encode58} from '../../server/base58.mjs';
import {localRuntime} from './local-runtime.mjs';
const origin='http://localhost',path=origin+'/api/v1/notifications',terms='10x-notice-local-inbox-v1';
test('actual local D1 consent HTTP uses live owner sessions, no-store and exact revoked replay',async t=>{
 const {mf,db}=await localRuntime(t,new URL('../src/worker.ts',import.meta.url)),wallets=[19,20].map(n=>encode58(new Uint8Array(32).fill(n))),tokens=['synthetic-alice','synthetic-bob'];
 for(let i=0;i<2;i++)await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(createHash('sha256').update(tokens[i]).digest('hex'),wallets[i],origin,Date.now()+60000).run();
 const send=(suffix='/subscriptions',{body,key='synthetic-enable',owner=0,headers={},method=body?'POST':'GET'}={})=>mf.dispatchFetch(path+suffix,{method,headers:{origin,'content-type':'application/json','idempotency-key':key,...(owner===null?{}:{cookie:'tenx_edge_local_session='+tokens[owner]}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const discovery=await (await mf.dispatchFetch(origin+'/api/v1/capabilities')).json();assert.equal(discovery.production.financialExecution,false);assert.equal(discovery.features.find(f=>f.id==='local-inbox').routes.length,4);
 const input={channel:'local-inbox',enabled:true,topics:['launch'],terms,expectedRevision:0};
 assert.equal((await send('/subscriptions',{owner:null})).status,401);
 assert.equal((await send('/subscriptions',{body:input,headers:{origin:'https://elsewhere.invalid'}})).status,403);
 assert.equal((await send('/subscriptions',{body:{...input,wallet:wallets[1]}})).status,400);
 const enabled=await send('/subscriptions',{body:input});assert.equal(enabled.status,200);assert.equal(enabled.headers.get('cache-control'),'no-store');assert.equal((await enabled.json()).appliedRevision,1);
 assert.equal((await (await send('/subscriptions',{owner:1})).json()).enabled,false);
 assert.equal((await send('/subscriptions',{owner:1,body:input})).status,200);
 // Explicit retained legacy inbox read fixtures; this is not delivery acceptance.
 const now=Date.now(),ids=[];
 for(let n=0;n<28;n++){
  const id=createHash('sha256').update('synthetic-inbox-'+n).digest('hex'),owner=n===27?wallets[1]:wallets[0];ids.push(id);
  await db.batch([db.prepare('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,'local-inbox',1,'launch','synthetic-market','Market opened','A local ATT campaign is available.','/markets/synthetic-market',now-1000,n===26?now-1:now+60000,'delivered',1,now-1000,null,null),db.prepare('INSERT INTO notice_inbox VALUES(?,?,?)').bind(id,owner,now-1000)]);
 }
 const firstResponse=await send('/inbox'),first=await firstResponse.json();assert.equal(firstResponse.status,200);assert.equal(firstResponse.headers.get('cache-control'),'no-store');assert.equal(first.items.length,25);assert.ok(first.nextCursor);assert.ok(first.items.every(n=>n.id!==ids[26]&&n.id!==ids[27]));
 const second=await (await send('/inbox?cursor='+encodeURIComponent(first.nextCursor))).json();assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);assert.ok(!first.items.some(n=>n.id===second.items[0].id));
 const bob=await (await send('/inbox',{owner:1})).json();assert.equal(bob.items.length,1);assert.equal(bob.items[0].id,ids[27]);
 assert.equal((await send('/inbox?cursor=invalid')).status,400);

 const revoked=await send('/subscriptions',{key:'synthetic-revoke',body:{...input,enabled:false,topics:[],expectedRevision:1}});assert.equal(revoked.status,200);
 const replay=await (await send('/subscriptions',{body:input})).json();assert.equal(replay.replay,true);assert.equal(replay.appliedRevision,1);assert.equal(replay.preference.enabled,false);assert.equal(replay.preference.revision,2);
 assert.equal(await db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='notifications.set-consent.v1'").first('n'),3);
 assert.equal((await send('/subscriptions',{body:{...input,topics:['voting']}})).status,409);
 const caps=await (await send('/capabilities',{owner:null})).json();assert.equal(caps.externalTransport,false);assert.equal(caps.channel,'local-inbox');
 await db.prepare('DELETE FROM sessions WHERE wallet=?').bind(wallets[0]).run();assert.equal((await send()).status,401);
 assert.equal((await send('/enqueue',{body:{wallet:wallets[0],message:'untrusted'}})).status,404);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM notice_outbox').first('n'),28);assert.equal((await (await send('/inbox',{owner:1})).json()).items.length,1);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM notice_inbox WHERE wallet=?').bind(wallets[0]).first('n'),0);
 t.diagnostic(JSON.stringify({source:'synthetic-local-notice-http',actualSqlClock:true,ownerIsolation:true,revokedReplay:true,noDeliveryRoute:true,externalTransport:false}));
});
