import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {measureBatch} from './atomic-driver.mjs';
import {createNotificationConsentRepository} from './notification-consent.mjs';
import {buildNotificationConsentCommand,NOTICE_TERMS} from '../notifications/consent.mjs';
import {setConsent,enqueueNotice,leaseDue,finishLease} from '../notifications/notices.mjs';
const START=Date.UTC(2026,10,7,12),wallet=encode58(new Uint8Array(32).fill(9)),other=encode58(new Uint8Array(32).fill(8)),principal={kind:'wallet',wallet},crypto=createNodeCrypto();
const input={channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0};
function fixture(t,{fault=null}={}){
 const db=openDatabase();t.after(()=>db.close());let now=START,injected=false;db.function('synthetic_consent_clock',()=>now);const base={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_consent_clock()'},metrics=[];
 const driver={...base,async batch(statements){
  const writes=statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'));
  if(writes&&!injected&&['expire','source-race','generation-race'].includes(fault)){injected=true;if(fault==='expire')now+=30001;else if(fault==='source-race')db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();else db.prepare("UPDATE app_recovery_state SET generation='synthetic-new-generation'").run();}
  const needles={'omit-pref':'INSERT INTO notice_preferences','omit-key':'INSERT INTO notice_consent_requests','omit-cancel':'UPDATE notice_outbox','omit-inbox':'DELETE FROM notice_inbox'};
  const selected=statements.flatMap(s=>{if(needles[fault]&&s.sql.startsWith(needles[fault])){injected=true;return [];}if(fault==='wrong-pref'&&s.sql.startsWith('INSERT INTO notice_preferences')){injected=true;const values=[...s.values];values[2]++;return [{...s,values}];}if(fault==='wrong-key'&&s.sql.startsWith('INSERT INTO notice_consent_requests')){injected=true;const values=[...s.values];values[3]='f'.repeat(64);return [{...s,values}];}if(fault==='uncleared-lease'&&s.sql.startsWith('UPDATE notice_outbox')){injected=true;return [{...s,sql:s.sql.replace(',lease=NULL,lease_until_ms=NULL','')}];}return [s];});
  metrics.push(measureBatch(selected));const result=await base.batch(selected);if(writes&&!injected&&fault==='lost-response'){injected=true;throw Error('Synthetic lost acknowledgement.');}return result;
 }};
 const repo=createNotificationConsentRepository(driver,{crypto,clock:{nowMs:()=>now},ids:{next:randomUUID}}),command=(changes={},key='enable',p=principal)=>buildNotificationConsentCommand({principal:p,requestKey:key,input:{...input,...changes},nowMs:now},crypto);
 return {db,base,driver,repo,metrics,command,setNow:v=>now=v,getNow:()=>now,injected:()=>injected,run:async(changes={},key='enable',p=principal)=>repo.setConsent(await command(changes,key,p))};
}
function seedWork(f){
 setConsent(f.db,{wallet,channel:'local-inbox',enabled:true,selectedTopics:['launch'],terms:NOTICE_TERMS,expectedRevision:0,requestKey:'legacy-enable',now:START-1});
 for(let n=0;n<3;n++)f.db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(n+1,'synthetic-market-'+n,'mint-'+n,'pool-'+n,JSON.stringify({activatedAt:new Date(START-1000).toISOString()}));
 for(let n=0;n<3;n++)enqueueNotice(f.db,{wallet,topic:'launch',subject:'synthetic-market-'+n,now:START});
 const leases=leaseDue(f.db,{now:START,limit:2});finishLease(f.db,{...leases[0],now:START});return leases[1];
}
const snapshot=db=>canonicalJson(['notice_preferences','notice_consent_requests','notice_outbox','notice_inbox','app_command_receipts'].map(t=>[t,db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()]));
test('guarded consent is off by default, exact legacy-compatible, and replay reports current revoked preference',async t=>{
 const f=fixture(t);assert.equal((await f.repo.readPreferences(principal)).enabled,false);
 const enabled=await f.run();assert.equal(enabled.appliedRevision,1);assert.equal(enabled.replay,false);
 const row=f.db.prepare('SELECT * FROM notice_consent_requests').get(),legacy=openDatabase();t.after(()=>legacy.close());const reference=setConsent(legacy,{wallet,channel:input.channel,enabled:true,selectedTopics:input.topics,terms:NOTICE_TERMS,expectedRevision:0,requestKey:'enable',now:START});assert.deepEqual(enabled,reference);assert.equal(row.request_hash,legacy.prepare('SELECT request_hash FROM notice_consent_requests').get().request_hash);
 f.setNow(START+1);const revoked=await f.run({enabled:false,topics:[],expectedRevision:1},'revoke');assert.equal(revoked.appliedRevision,2);assert.equal(revoked.preference.enabled,false);
 const before=snapshot(f.db),retry=await f.run();assert.equal(retry.appliedRevision,1);assert.equal(retry.preference.enabled,false);assert.equal(retry.preference.revision,2);assert.equal(retry.replay,true);assert.equal(snapshot(f.db),before);
 assert.equal((await f.run({topics:['voting']})).code,'key_conflict');assert.equal((await f.repo.readPreferences({kind:'wallet',wallet:other})).revision,0);
 const r=f.db.prepare('SELECT result_json,input_json FROM app_command_receipts WHERE request_key=?').get('enable');assert.deepEqual(JSON.parse(r.result_json),{appliedRevision:1});assert.deepEqual(JSON.parse(r.input_json),input);
 for(const sql of ['UPDATE notice_consent_requests SET request_hash=request_hash','DELETE FROM notice_consent_requests'])assert.throws(()=>f.db.exec(sql),/Retain guarded consent/);
});
test('revoke clears private inbox and fences existing leased and queued work despite optional pause; legacy replay has no backfill',async t=>{
 const f=fixture(t),lease=seedWork(f);f.db.prepare("INSERT INTO ops_scope_log VALUES('synthetic-pause','optional-notifications',1,NULL,?,'fixture','pause','fixture','pause')").run(START);
 const result=await f.run({enabled:false,topics:[],expectedRevision:1},'revoke');assert.equal(result.appliedRevision,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);assert.equal(finishLease(f.db,{...lease,now:START+1}).state,'fenced');assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notice_outbox WHERE state IN ('queued','leased','retry','unknown')").get().n,0);
 const before=snapshot(f.db),legacy=await f.run({},'legacy-enable');assert.equal(legacy.appliedRevision,1);assert.equal(legacy.preference.enabled,false);assert.equal(legacy.replay,true);assert.equal(snapshot(f.db),before);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
});
test('omitted and altered preference/key/cancellation/inbox/lease effects roll back together',async t=>{
 for(const fault of ['omit-pref','wrong-pref','omit-key','wrong-key','omit-cancel','omit-inbox','uncleared-lease']){const f=fixture(t,{fault});seedWork(f);const before=snapshot(f.db);await assert.rejects(f.run({enabled:false,topics:[],expectedRevision:1},'revoke'));assert.equal(f.injected(),true,fault);assert.equal(snapshot(f.db),before,fault);}
});
test('concurrent same-key replay and different-key revision contenders cannot split consent history',async t=>{
 const f=fixture(t),pair=await Promise.all([f.run(),f.run()]);assert.deepEqual(pair.map(r=>r.replay).sort(),[false,true]);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
 const commands=await Promise.all([f.command({enabled:false,topics:[],expectedRevision:1},'revoke-a'),f.command({enabled:false,topics:[],expectedRevision:1},'revoke-b')]),next=await Promise.all(commands.map(c=>f.repo.setConsent(c)));assert.equal(next.filter(r=>r.appliedRevision===2).length,1);assert.equal(next.filter(r=>r.kind==='conflict').length,1);assert.equal((await f.repo.readPreferences(principal)).enabled,false);
});
test('unknown committed acknowledgement resolves original identity; stalled/hash-time revision and recovery generation races cannot commit',async t=>{
 const lost=fixture(t,{fault:'lost-response'}),accepted=await lost.run();assert.equal(accepted.appliedRevision,1);assert.equal(accepted.replay,true);assert.equal(lost.db.prepare('SELECT COUNT(*) n FROM notice_consent_requests').get().n,1);
 for(const fault of ['expire','source-race','generation-race']){const f=fixture(t,{fault}),out=await f.run();assert.equal(f.injected(),true);assert.equal(out.code,'revision_conflict');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);assert.equal((await f.repo.readPreferences(principal)).enabled,false);}
});
test('live recovery state and monotonic execution clock gate new consent but never rewrite accepted replay',async t=>{
 const f=fixture(t);await f.run();f.setNow(START-1);assert.equal((await f.run({enabled:false,topics:[],expectedRevision:1},'backdated')).code,'consent_conflict');
 f.db.prepare("UPDATE app_recovery_state SET status='held'").run();assert.equal((await f.run({enabled:false,topics:[],expectedRevision:1},'held')).reason,'read-only-recovery');assert.equal((await f.run()).replay,true);
 f.db.prepare("UPDATE app_recovery_state SET status='live'").run();f.setNow(8640000000000000);assert.equal((await f.run({enabled:false,topics:[],expectedRevision:1},'unsafe-clock')).reason,'consent-clock-unavailable');
});


test('source change during awaited output hashing is fenced before any consent effect',async t=>{
 const f=fixture(t),command=await f.command();let changed=false;
 const hashing={...crypto,async sha256(bytes){const digest=await crypto.sha256(bytes);if(new TextDecoder().decode(bytes)==='{"appliedRevision":1}'&&!changed){changed=true;f.db.prepare("UPDATE app_revisions SET revision=revision+1 WHERE name='source'").run();}return digest;}};
 const repo=createNotificationConsentRepository(f.base,{crypto:hashing,clock:{nowMs:()=>START},ids:{next:randomUUID}});
 assert.equal((await repo.setConsent(command)).code,'revision_conflict');assert.equal(changed,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_preferences').get().n,0);
});

test('ninety days of actual three-per-day local notices revoke in one bounded batch while retaining consent and source history',async t=>{
 const f=fixture(t),DAY=86400000;setConsent(f.db,{wallet,channel:'local-inbox',enabled:true,selectedTopics:['launch'],terms:NOTICE_TERMS,expectedRevision:0,requestKey:'legacy-accumulated',now:START-1});
 let sequence=0;
 for(let day=0;day<90;day++){
  const now=START+day*DAY;
  for(let n=0;n<3;n++){const id=++sequence,market='synthetic-accumulated-'+id;f.db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(id,market,'mint-'+id,'pool-'+id,JSON.stringify({activatedAt:new Date(now).toISOString()}));assert.equal(enqueueNotice(f.db,{wallet,topic:'launch',subject:market,now}).state,'queued');}
  const leases=leaseDue(f.db,{now});assert.equal(leases.length,3);for(const lease of leases)assert.equal(finishLease(f.db,{...lease,now}).state,'delivered');
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,270);
 f.setNow(START+90*DAY);const result=await f.run({enabled:false,topics:[],expectedRevision:1},'revoke-accumulated');assert.equal(result.appliedRevision,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_outbox').get().n,270);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notice_consent_requests').get().n,2);assert.ok(f.metrics.every(m=>m.statements<=7&&m.batchBytes<=16384&&m.maxParameters<=100));
 t.diagnostic(JSON.stringify({actualLocalDeliveries:270,maxSqlBatch:Math.max(...f.metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...f.metrics.map(m=>m.batchBytes)),maxParameters:Math.max(...f.metrics.map(m=>m.maxParameters)),externalTransport:false}));
});
