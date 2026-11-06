import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
import {createNotificationDeliveryRepository} from './notification-delivery.mjs';
import {buildEnqueueNoticeCommand,ENQUEUE_NOTICE,DELIVER_NOTICE} from '../notifications/delivery-plan.mjs';
import {setConsent,enqueueNotice,finishLease as legacyFinishLease} from '../notifications/notices.mjs';
import {NOTICE_TERMS} from '../notifications/consent.mjs';
import {createNotificationConsentRepository} from './notification-consent.mjs';
import {buildNotificationConsentCommand} from '../notifications/consent.mjs';
import {changeScope} from '../operations/controls.mjs';
import {measureBatch} from './atomic-driver.mjs';
const START=Date.UTC(2026,10,7,12),DAY=86400000,wallet=encode58(new Uint8Array(32).fill(9)),other=encode58(new Uint8Array(32).fill(8)),principal={kind:'operator',id:'synthetic-notice-worker'},crypto=createNodeCrypto();
function fixture(t,{fault=null}={}){
 const db=openDatabase();t.after(()=>db.close());let now=START,injected=false;db.function('synthetic_notice_clock',()=>now);const base={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_notice_clock()'},metrics=[];
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'notification-work');
 for(const w of [wallet,other])setConsent(db,{wallet:w,channel:'local-inbox',enabled:true,selectedTopics:['launch','voting','rewards'],terms:NOTICE_TERMS,expectedRevision:0,requestKey:'enable',now:START-1});
 for(let i=1;i<=5;i++)db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(i,'synthetic-market-'+i,'mint-'+i,'pool-'+i,JSON.stringify({activatedAt:new Date(START).toISOString()}));
 const driver={...base,async batch(statements){
  const claim=statements.find(s=>s.sql.startsWith('INSERT INTO app_command_receipts')),kind=claim?.values[2];
  if(claim&&!injected&&['source-race','expire','revoke-worker','consent-race'].includes(fault)){
   injected=true;if(fault==='expire')now+=30001;else if(fault==='source-race')db.prepare('UPDATE market_fixtures SET body=? WHERE id=?').run(JSON.stringify({activatedAt:new Date(START+DAY).toISOString()}),'synthetic-market-1');else if(fault==='revoke-worker')db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);else setConsent(db,{wallet,channel:'local-inbox',enabled:false,selectedTopics:[],terms:NOTICE_TERMS,expectedRevision:1,requestKey:'race-revoke',now});
  }
  const selected=statements.flatMap(s=>{const omitted=fault==='omit-outbox'&&kind===ENQUEUE_NOTICE&&s.sql.startsWith('INSERT INTO notice_outbox')||fault==='omit-inbox'&&kind===DELIVER_NOTICE&&s.sql.startsWith('INSERT INTO notice_inbox')||fault==='omit-delivered'&&kind===DELIVER_NOTICE&&s.sql.startsWith('UPDATE notice_outbox');if(omitted){injected=true;return [];}if(fault==='alter-template'&&s.sql.startsWith('INSERT INTO notice_outbox')){injected=true;const values=[...s.values];values[6]='Arbitrary text';return [{...s,values}];}return [s];});
  metrics.push(measureBatch(selected));const result=await base.batch(selected);if(claim&&!injected&&(fault==='lost-enqueue'&&kind===ENQUEUE_NOTICE||fault==='lost-delivery'&&kind===DELIVER_NOTICE)){injected=true;throw Error('Synthetic notice response loss.');}return result;
 }};
 const ports={crypto,clock:{nowMs:()=>now},ids:{next:randomUUID}},repo=createNotificationDeliveryRepository(driver,ports),enqueue=async(subject='synthetic-market-1',topic='launch',w=wallet,key='enqueue:'+String(subject))=>repo.enqueueNotice(await buildEnqueueNoticeCommand({principal,input:{wallet:w,topic,subject},requestKey:key,nowMs:now},crypto));
 return {db,base,ports,driver,repo,enqueue,metrics,setNow:n=>now=n,getNow:()=>now,injected:()=>injected};
}
const snapshot=db=>canonicalJson(['notice_outbox','notice_inbox','app_command_receipts'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
test('portable enqueue matches original launch/vote/reward IDs and templates; public reads stay owner scoped',async t=>{
 const f=fixture(t),legacy=openDatabase();t.after(()=>legacy.close());
 // Copy only explicit synthetic source/consent rows to reference; no guarded receipts.
 for(const table of ['market_fixtures','notice_preferences'])for(const row of f.db.prepare('SELECT * FROM '+table).all())legacy.prepare('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
 for(const db of [f.db,legacy]){db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run('synthetic-ballot',START,START+10000,START-7*DAY,'a'.repeat(64),1);db.prepare('INSERT INTO genesis_voters VALUES(?,?)').run('synthetic-ballot',wallet);db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('synthetic-token',START-10*DAY,'10000');db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(Math.floor(START/DAY),'[]',START,'a'.repeat(64),'synthetic-notice-source');db.prepare('INSERT INTO earn_allocations VALUES(?,?,?,?,?,?,?,?)').run('synthetic-token',1,Math.floor(START/DAY),START-1000,START-1,START+10000,'10','0');db.prepare('INSERT INTO earn_awards VALUES(?,?,?,?)').run('synthetic-token',1,wallet,'10');}
 for(const [topic,subject,key] of [['launch','synthetic-market-1','launch'],['voting','synthetic-ballot','voting'],['rewards',{tokenId:'synthetic-token',day:1},'rewards']]){
  const expected=enqueueNotice(legacy,{wallet,topic,subject,now:START}),actual=await f.enqueue(subject,topic,wallet,key);assert.deepEqual(actual,expected);assert.deepEqual({...f.db.prepare('SELECT * FROM notice_outbox WHERE id=?').get(actual.id)},{...legacy.prepare('SELECT * FROM notice_outbox WHERE id=?').get(actual.id)});
 }
 const leases=await f.repo.leaseDue(principal);assert.equal(leases.length,3);for(const lease of leases)assert.equal((await f.repo.finishLease(principal,lease)).state,'delivered');
 const one=await f.repo.readInbox({kind:'wallet',wallet},{limit:2});assert.equal(one.items.length,2);assert.ok(one.nextCursor);const rest=await f.repo.readInbox({kind:'wallet',wallet},{cursor:one.nextCursor});assert.equal(rest.items.length,1);assert.equal((await f.repo.readInbox({kind:'wallet',wallet:other})).items.length,0);
 assert.equal((await f.enqueue()).state,'delivered');
});
test('daily count races cap three actual events; workers claim each lease once and count actual attempts',async t=>{
 const f=fixture(t),results=await Promise.all([1,2,3,4].map(i=>f.enqueue('synthetic-market-'+i)));assert.equal(results.filter(r=>r.state==='queued').length,3);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,3);
 assert.equal((await f.enqueue('synthetic-market-4')).reason,'daily-cap');assert.equal((await f.enqueue('synthetic-market-4','launch',other)).state,'queued');
 const leases=(await Promise.all([f.repo.leaseDue(principal),f.repo.leaseDue(principal)])).flat();assert.equal(leases.length,4);assert.equal(new Set(leases.map(l=>l.id)).size,4);assert.ok(f.db.prepare('SELECT attempts FROM notice_outbox').all().every(r=>r.attempts===1));
 const again=await f.repo.leaseDue(principal);assert.deepEqual(again,[]);
});
test('enqueue missing/template effects and source/clock/consent/worker races never commit a false event',async t=>{
 for(const fault of ['omit-outbox','alter-template']){const f=fixture(t,{fault}),before=snapshot(f.db);await assert.rejects(f.enqueue());assert.equal(f.injected(),true);assert.equal(snapshot(f.db),before);}
 for(const fault of ['source-race','expire','consent-race','revoke-worker']){const f=fixture(t,{fault}),result=await f.enqueue();assert.equal(f.injected(),true);assert.equal(result.kind,'conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);}
});
test('delivery missing either mandatory effect rolls back receipt and inbox, and lost delivery response replays after revoke',async t=>{
 for(const fault of ['omit-inbox','omit-delivered']){const f=fixture(t,{fault});await f.enqueue();const [lease]=await f.repo.leaseDue(principal),before=snapshot(f.db);await assert.rejects(f.repo.finishLease(principal,lease));assert.equal(f.injected(),true);assert.equal(snapshot(f.db),before);}
 const f=fixture(t,{fault:'lost-delivery'});await f.enqueue();const [lease]=await f.repo.leaseDue(principal),done=await f.repo.finishLease(principal,lease);assert.equal(done.state,'delivered');assert.equal(f.injected(),true);
 const consent=createNotificationConsentRepository(f.base,f.ports);await consent.setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet},requestKey:'revoke',input:{channel:'local-inbox',enabled:false,topics:[],terms:NOTICE_TERMS,expectedRevision:1},nowMs:START},crypto));f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();
 const before=snapshot(f.db);assert.deepEqual(await f.repo.finishLease(principal,lease),done);assert.equal(snapshot(f.db),before);assert.equal((await f.repo.readInbox({kind:'wallet',wallet})).items.length,0);
});
test('expired leases become unknown, explicit reconciliation respects pause/revocation and retries are bounded',async t=>{
 const f=fixture(t);await f.enqueue();const [first]=await f.repo.leaseDue(principal);f.setNow(START+30000);assert.equal((await f.repo.finishLease(principal,first)).state,'fenced');assert.deepEqual(await f.repo.leaseDue(principal),[]);assert.equal(f.db.prepare('SELECT state FROM notice_outbox').get().state,'unknown');
 changeScope(f.db,{scope:'optional-notifications',paused:true,previousRevision:null,atMs:f.getNow(),actor:principal.id,reason:'Synthetic pause',evidenceRef:'synthetic',requestKey:'pause'});
 assert.equal((await f.repo.reconcileUnknown(principal,{id:first.id})).state,'retry');assert.deepEqual(await f.repo.leaseDue(principal),[]);
 const row=f.db.prepare('SELECT revision FROM ops_scope_log').get();changeScope(f.db,{scope:'optional-notifications',paused:false,previousRevision:row.revision,atMs:f.getNow()+1,actor:principal.id,reason:'Synthetic resume',evidenceRef:'synthetic',requestKey:'resume'});f.setNow(f.getNow()+1);
 for(let attempt=2;attempt<=5;attempt++){const [lease]=await f.repo.leaseDue(principal);assert.ok(lease);const result=await f.repo.finishLease(principal,{...lease,outcome:'retryable'});assert.equal(result.state,attempt===5?'cancelled':'retry');assert.equal(f.db.prepare('SELECT attempts FROM notice_outbox').get().attempts,attempt);f.setNow(f.getNow()+Math.min(3600000,60000*2**(attempt-1)));}
 assert.deepEqual(await f.repo.leaseDue(principal),[]);assert.equal((await f.repo.finishLease(principal,first)).state,'fenced');
});
test('TTL, missing source and pruned accepted enqueue never manufacture new work',async t=>{
 const f=fixture(t,{fault:'lost-enqueue'}),first=await f.enqueue();assert.equal(first.replay,true);assert.equal((await f.enqueue('missing-market')).reason,'no-current-event');f.setNow(START+DAY);assert.deepEqual(await f.repo.leaseDue(principal),[]);assert.equal(f.db.prepare('SELECT state FROM notice_outbox').get().state,'cancelled');
 f.db.prepare('DELETE FROM notice_outbox').run();const before=snapshot(f.db),replay=await f.enqueue();assert.deepEqual(replay,{state:'held',reason:'notice-history-unavailable',id:first.id,replay:true});assert.equal(snapshot(f.db),before);
});


test('twenty expired and twenty fresh candidates stay bounded and attempt counters count only claimed leases',async t=>{
 const f=fixture(t);for(let n=1;n<=40;n++){
  const w=encode58(new Uint8Array(32).fill(n+20));setConsent(f.db,{wallet:w,channel:'local-inbox',enabled:true,selectedTopics:['launch'],terms:NOTICE_TERMS,expectedRevision:0,requestKey:'capacity-enable-'+n,now:START-1});
  const result=await f.enqueue('synthetic-market-1','launch',w,'capacity-event-'+n);assert.equal(result.state,'queued');
 }
 const first=await f.repo.leaseDue(principal,{limit:20});assert.equal(first.length,20);f.setNow(START+30000);const before=f.metrics.length,next=await f.repo.leaseDue(principal,{limit:20}),m=f.metrics.slice(before);assert.equal(next.length,20);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notice_outbox WHERE state='unknown'").get().n,20);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notice_outbox WHERE state='leased'").get().n,20);assert.ok(f.db.prepare('SELECT attempts FROM notice_outbox').all().every(r=>r.attempts===1));
 assert.ok(m.reduce((n,r)=>n+r.statements,0)<=64);assert.ok(m.every(r=>r.batchBytes<=262144&&r.maxParameters<=100));t.diagnostic(JSON.stringify({expired:20,claimed:20,sqlStatements:m.reduce((n,r)=>n+r.statements,0),maxBatchBytes:Math.max(...m.map(r=>r.batchBytes)),maxParameters:Math.max(...m.map(r=>r.maxParameters))}));
});

test('private inbox rejects corrupt cross-origin/backslash targets and oversized retained text before exposing them',async t=>{
 const f=fixture(t);await f.enqueue();const [lease]=await f.repo.leaseDue(principal);await f.repo.finishLease(principal,lease);
 for(const target of ['//evil.invalid','/\\evil.invalid','/markets/a?redirect=external','/markets/a\n']){
  const driver={...f.base,async batch(statements){const result=await f.base.batch(statements);return result.map((r,n)=>statements[n].sql.includes('delivered_ms AS deliveredMs')?{...r,rows:r.rows.map(row=>({...row,target}))}:r);}};
  await assert.rejects(createNotificationDeliveryRepository(driver,f.ports).readInbox({kind:'wallet',wallet}),/Invalid retained inbox/);
 }
 const driver={...f.base,async batch(statements){const result=await f.base.batch(statements);return result.map((r,n)=>statements[n].sql.includes('delivered_ms AS deliveredMs')?{...r,rows:r.rows.map(row=>({...row,message:null}))}:r);}};
 await assert.rejects(createNotificationDeliveryRepository(driver,f.ports).readInbox({kind:'wallet',wallet}),/Invalid retained inbox/);
});


test('guarded enqueue content and delivered transition cannot bypass the permanent local effect receipt',async t=>{
 const f=fixture(t);await f.enqueue();const [lease]=await f.repo.leaseDue(principal),before=snapshot(f.db);
 assert.throws(()=>legacyFinishLease(f.db,{...lease,now:START}),/Guarded notice|delivery receipt/i);assert.equal(snapshot(f.db),before);
 for(const field of ['title','message','target','subject'])assert.throws(()=>f.db.prepare('UPDATE notice_outbox SET '+field+'=?').run('changed'),/Retain guarded notice source and content/);
 assert.equal((await f.repo.finishLease(principal,lease)).state,'delivered');
});
