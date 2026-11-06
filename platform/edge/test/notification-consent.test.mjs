import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createNotificationConsentRepository} from '../../storage/notification-consent.mjs';
import {buildNotificationConsentCommand,NOTICE_TERMS} from '../../notifications/consent.mjs';
import {encode58} from '../../server/base58.mjs';
import {canonicalJson} from '../../security/canonical.mjs';
const START=Date.UTC(2026,10,7,12),wallet=encode58(new Uint8Array(32).fill(9)),other=encode58(new Uint8Array(32).fill(8)),input={channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0};
const tables=['notice_preferences','notice_consent_requests','notice_outbox','notice_inbox','app_command_receipts'];
test('actual local D1 consent preserves Node identities and atomic revoke, replay, clock and recovery fences',async t=>{
 const node=openDatabase();t.after(()=>node.close());const {mf,db}=await localRuntime(t,new URL('./fixtures/notification-consent-worker.ts',import.meta.url)),metrics=[];let calls=0;
 node.exec('CREATE TABLE notification_consent_fixture_clock(now_ms INTEGER)');node.prepare('INSERT INTO notification_consent_fixture_clock VALUES(?)').run(START);
 await db.batch([db.prepare('CREATE TABLE notification_consent_fixture_clock(now_ms INTEGER)'),db.prepare('INSERT INTO notification_consent_fixture_clock VALUES(?)').bind(START)]);
 const snapshot=async()=>canonicalJson(await Promise.all(tables.map(async name=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results])));
 const call=async(extra={},paired=false)=>{const body={wallet,input,requestKey:'enable',nowMs:START,idPrefix:'synthetic-notice-'+(++calls),...extra},response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(body)});assert.equal(response.status,200);const out=await response.json();metrics.push(out.metrics);
  if(paired){node.prepare('UPDATE notification_consent_fixture_clock SET now_ms=?').run(body.nowMs);let n=0;const crypto=createNodeCrypto(),repo=createNotificationConsentRepository({...createNodeAtomicDriver(node),leaseNowSql:'(SELECT now_ms FROM notification_consent_fixture_clock)'},{crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>body.idPrefix+'-'+(++n)}}),principal={kind:'wallet',wallet:body.wallet},expected=body.read?await repo.readPreferences(principal):await repo.setConsent(await buildNotificationConsentCommand({principal,input:body.input,requestKey:body.requestKey,nowMs:body.nowMs},crypto));assert.equal(out.status,200);assert.deepEqual(out.result,expected);assert.equal(await snapshot(),canonicalJson(tables.map(name=>[name,node.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])));}
  return out;
 };
 assert.equal((await call({read:true},true)).result.enabled,false);assert.equal((await call({},true)).result.replay,false);assert.equal((await call({},true)).result.replay,true);
 assert.equal((await call({input:{...input,topics:['voting']}},true)).result.code,'key_conflict');
 // Explicit synthetic inbox/lease states, independently inserted identically in both runtimes.
 const outbox="INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
 for(const [id,state] of [['synthetic-delivered','delivered'],['synthetic-leased','leased'],['synthetic-queued','queued'],['synthetic-unknown','unknown'],['synthetic-retry','retry']]){
  const values=[id,wallet,'local-inbox',1,'launch','synthetic-market','Synthetic title','Synthetic local fixture message','/markets/synthetic',START,START+86400000,state,1,START,state==='leased'?'synthetic-lease':null,state==='leased'?START+30000:null];node.prepare(outbox).run(...values);await db.prepare(outbox).bind(...values).run();
 }
 node.prepare('INSERT INTO notice_inbox VALUES(?,?,?)').run('synthetic-delivered',wallet,START);await db.prepare('INSERT INTO notice_inbox VALUES(?,?,?)').bind('synthetic-delivered',wallet,START).run();
 const revoke={input:{...input,enabled:false,topics:[],expectedRevision:1},requestKey:'revoke',nowMs:START+1};
 for(const fault of ['omit-pref','wrong-pref','omit-key','wrong-key','omit-cancel','omit-inbox','uncleared-lease']){const before=await snapshot(),out=await call({...revoke,fault});assert.equal(out.status,500,fault);assert.equal(out.injected,true);assert.equal(await snapshot(),before);}
 for(const fault of ['expire','source-race','generation-race']){const before=await snapshot(),out=await call({...revoke,fault});assert.equal(out.result.code,'revision_conflict');assert.equal(out.injected,true);assert.equal(await snapshot(),before);}
 // Synchronize private control clocks/revisions after explicit D1-only injected races.
 for(const row of (await db.prepare('SELECT name,revision FROM app_revisions').all()).results)node.prepare('UPDATE app_revisions SET revision=? WHERE name=?').run(row.revision,row.name);
 node.prepare("UPDATE app_recovery_state SET generation='synthetic-new-generation'").run();
 assert.equal((await call(revoke,true)).result.appliedRevision,2);assert.equal(await db.prepare('SELECT COUNT(*) n FROM notice_inbox').first('n'),0);
 const original=await call({nowMs:START+2},true);assert.equal(original.result.appliedRevision,1);assert.equal(original.result.preference.enabled,false);assert.equal(original.result.replay,true);
 assert.equal((await call({wallet:other,read:true},true)).result.revision,0);
 const fresh={wallet:other,requestKey:'other-enable',nowMs:START+2};const unknown=await call({...fresh,fault:'lost-response'});assert.equal(unknown.result.replay,true);assert.equal(unknown.result.preference.enabled,true);assert.equal((await call(fresh)).result.replay,true);
 await db.prepare("UPDATE app_recovery_state SET status='held'").run();assert.equal((await call({wallet:other,requestKey:'held-revoke',input:{...input,enabled:false,topics:[],expectedRevision:1}})).result.reason,'read-only-recovery');assert.equal((await call(fresh)).result.replay,true);
 await db.prepare("UPDATE app_recovery_state SET status='live'").run();
 const third=encode58(new Uint8Array(32).fill(7)),race=await Promise.all([call({wallet:third,requestKey:'concurrent-enable'}),call({wallet:third,requestKey:'concurrent-enable'})]);
 assert.deepEqual(race.map(r=>r.result.replay).sort(),[false,true]);assert.equal(await db.prepare('SELECT COUNT(*) n FROM notice_consent_requests WHERE wallet=?').bind(third).first('n'),1);
 for(const sql of ['UPDATE notice_consent_requests SET request_hash=request_hash','DELETE FROM notice_consent_requests'])await assert.rejects(db.prepare(sql).run(),/Retain guarded consent/);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM ops_config_audit').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);assert.equal((await mf.dispatchFetch('http://localhost/api/v1/notifications/subscriptions',{method:'POST'})).status,404);
 assert.ok(metrics.every(m=>m.statements<=32&&m.maxBatchBytes<=16384&&m.maxParameters<=100&&m.maxResultBytes<=32768));
 t.diagnostic(JSON.stringify({calls,maxSql:Math.max(...metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters)),maxResultBytes:Math.max(...metrics.map(m=>m.maxResultBytes)),externalTransport:false}));
});
