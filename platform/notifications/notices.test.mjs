import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from '../storage/database.mjs';
import { createApp } from '../server/application.mjs';
import { changeScope } from '../operations/controls.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { enqueueNotice, finishLease, inbox, leaseDue, preferences, purgeExpired, reconcileUnknown, setConsent, TERMS } from './notices.mjs';

const at=Date.UTC(2026,10,5,12),wallet='holder',channel='local-inbox';
function setup(t,n=1) {
  const db=openDatabase();t.after(()=>db.close());
  for(let i=1;i<=n;i++)db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)')
    .run(i,'market-'+i,'mint-'+i,'pool-'+i,JSON.stringify({activatedAt:new Date(at).toISOString()}));
  return db;
}
function consent(db,overrides={}) {
  return setConsent(db,{wallet,channel,enabled:true,selectedTopics:['launch'],terms:TERMS,expectedRevision:0,
    requestKey:'opt-in',now:at,...overrides});
}
function queue(db,id=1,extra={}) {return enqueueNotice(db,{wallet,topic:'launch',subject:'market-'+id,now:at,...extra});}
function stop(db,now=at) {return changeScope(db,{scope:'optional-notifications',paused:true,atMs:now,actor:'operator',
  reason:'pause local transport',evidenceRef:'drill',requestKey:'pause'});}
test('consent is scoped to a wallet and topic, duplicate events and leases produce one local receipt',t=>{
  const db=setup(t,4);
  assert.equal(queue(db).reason,'no-consent');
  assert.equal(preferences(db,wallet).enabled,false);
  consent(db);assert.equal(consent(db).replay,true);
  assert.equal(queue(db,1,{wallet:'other'}).reason,'no-consent');
  assert.equal(enqueueNotice(db,{wallet,topic:'voting',subject:'ballot',now:at}).reason,'no-consent');
  const event=queue(db);assert.equal(queue(db).id,event.id);
  queue(db,2);queue(db,3);assert.equal(queue(db,4).reason,'daily-cap');
  const first=leaseDue(db,{now:at,limit:1})[0],rest=leaseDue(db,{now:at,limit:20});
  assert.equal(rest.length,2);
  assert.equal(finishLease(db,{...first,now:at}).state,'delivered');
  assert.equal(finishLease(db,{...first,now:at}).state,'fenced');
  for(const l of rest)finishLease(db,{...l,now:at});
  const page=inbox(db,{wallet,now:at,limit:2});
  assert.equal(page.items.length,2);const [time,id]=page.nextCursor.split('.');
  const last=inbox(db,{wallet,now:at,beforeMs:Number(time),beforeId:id});
  assert.equal(last.items.length,1);assert.equal(new Set([...page.items,...last.items].map(x=>x.id)).size,3);
  assert.equal(inbox(db,{wallet:'other',now:at}).items.length,0);
});
test('revoke fences a leased worker, clears local messages and old enable replay never opts the wallet back in',t=>{
  const db=setup(t,2);consent(db);queue(db,1);queue(db,2);const [one,two]=leaseDue(db,{now:at});
  finishLease(db,{...one,now:at});
  stop(db,at+1);
  const revoke=consent(db,{enabled:false,selectedTopics:[],expectedRevision:1,requestKey:'off',now:at+2});
  assert.equal(revoke.preference.enabled,false);
  assert.equal(finishLease(db,{...two,now:at+2}).state,'fenced');
  assert.equal(inbox(db,{wallet,now:at+2}).items.length,0);
  assert.equal(consent(db).preference.enabled,false);
  assert.equal(queue(db,1,{now:at+2}).reason,'no-consent');
});
test('expired leases become unknown before reconciliation; transient retry uses a bounded backoff and fence',t=>{
  const db=setup(t);consent(db);queue(db);
  const first=leaseDue(db,{now:at})[0];
  assert.deepEqual(leaseDue(db,{now:at+30001}),[]);
  assert.equal(db.prepare('SELECT state FROM notice_outbox').get().state,'unknown');
  assert.equal(reconcileUnknown(db,{id:first.id,now:at+30002}).state,'retry');
  const second=leaseDue(db,{now:at+30002})[0];
  assert.equal(finishLease(db,{...first,now:at+30003}).state,'fenced');
  assert.equal(finishLease(db,{...second,now:at+30003,outcome:'retryable'}).state,'retry');
  assert.deepEqual(leaseDue(db,{now:at+40000}),[]);
  const third=leaseDue(db,{now:at+150003})[0];assert.ok(third);
  finishLease(db,{...third,now:at+150003});
  assert.equal(purgeExpired(db,{now:at+10*DAY_MS}).outboxRemoved,1);
  assert.equal(queue(db,1,{now:at+10*DAY_MS}).reason,'no-current-event');
});
test('session HTTP accepts only explicit wallet-owned consent and bounded JSON, and exposes no receiver token fields',async t=>{
  const db=setup(t),token='test-session';
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),wallet,'http://localhost',at+DAY_MS);
  const app=createApp(db,{clock:()=>at});
  const path='http://localhost/api/v1/notifications/';
  const headers={'content-type':'application/json',origin:'http://localhost',cookie:'tenx_local_session='+token,'idempotency-key':'one'};
  const body={channel,enabled:true,topics:['launch'],terms:TERMS,expectedRevision:0};
  const post=(payload,h=headers)=>app(new Request(path+'subscriptions',{method:'POST',headers:h,body:JSON.stringify(payload)}));
  assert.equal((await app(new Request(path+'subscriptions'))).status,401);
  assert.equal((await post(body,{...headers,origin:'https://other.test'})).status,403);
  assert.equal((await post({...body,wallet:'other'})).status,400);
  assert.equal((await post({...body,channel:'email'})).status,400);
  assert.equal((await post({...body,terms:'future'})).status,400);
  assert.equal((await post({...body,terms:'a'.repeat(3000)})).status,413);
  assert.equal((await post(body)).status,200);
  assert.equal((await post({...body,topics:['voting']})).status,409);
  const own=await (await app(new Request(path+'subscriptions',{headers}))).json();
  assert.equal(own.enabled,true);assert.equal(own.revision,1);assert.equal(own.terms,TERMS);
  const cap=await (await app(new Request(path+'capabilities'))).json();assert.equal(cap.externalTransport,false);
});
