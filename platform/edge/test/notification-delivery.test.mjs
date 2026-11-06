import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createNotificationDeliveryRepository} from '../../storage/notification-delivery.mjs';
import {createNotificationConsentRepository} from '../../storage/notification-consent.mjs';
import {buildNotificationConsentCommand,NOTICE_TERMS} from '../../notifications/consent.mjs';
import {buildEnqueueNoticeCommand,ENQUEUE_NOTICE,DELIVER_NOTICE} from '../../notifications/delivery-plan.mjs';
import {encode58} from '../../server/base58.mjs';
import {canonicalJson} from '../../security/canonical.mjs';
const START=Date.UTC(2026,10,7,12),DAY=86400000,wallet=encode58(new Uint8Array(32).fill(9)),other=encode58(new Uint8Array(32).fill(8)),principal={kind:'operator',id:'synthetic-notice-worker'},crypto=createNodeCrypto();
async function nodeCall(db,b){
 db.prepare('UPDATE notification_delivery_fixture_clock SET now_ms=?').run(b.nowMs);let sequence=0,injected=false;const base=createNodeAtomicDriver(db),driver={...base,leaseNowSql:'(SELECT now_ms FROM notification_delivery_fixture_clock)',async batch(statements){
  const claim=statements.find(s=>s.sql.startsWith('INSERT INTO app_command_receipts')),kind=claim?.values[2];
  if(claim&&!injected&&['expire','revoke-worker','source-race'].includes(b.fault)){injected=true;if(b.fault==='expire')db.prepare('UPDATE notification_delivery_fixture_clock SET now_ms=?').run(b.nowMs+30001);else if(b.fault==='revoke-worker')db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);else db.prepare('UPDATE market_fixtures SET body=? WHERE id=?').run(JSON.stringify({activatedAt:new Date(b.nowMs+DAY).toISOString()}),'synthetic-market-1');}
  const selected=statements.flatMap(s=>{if(b.fault==='omit-outbox'&&kind===ENQUEUE_NOTICE&&s.sql.startsWith('INSERT INTO notice_outbox')||b.fault==='omit-inbox'&&kind===DELIVER_NOTICE&&s.sql.startsWith('INSERT INTO notice_inbox')||b.fault==='omit-delivered'&&kind===DELIVER_NOTICE&&s.sql.startsWith('UPDATE notice_outbox')){injected=true;return [];}if(b.fault==='alter-template'&&s.sql.startsWith('INSERT INTO notice_outbox')){injected=true;const values=[...s.values];values[6]='Arbitrary text';return [{...s,values}];}return [s];});
  const result=await base.batch(selected);if(claim&&!injected&&(b.fault==='lost-enqueue'&&kind===ENQUEUE_NOTICE||b.fault==='lost-delivery'&&kind===DELIVER_NOTICE)){injected=true;throw Error('Synthetic notice response loss.');}return result;
 }};
 try{const ports={crypto,clock:{nowMs:()=>b.nowMs},ids:{next:()=>b.idPrefix+'-'+(++sequence)}},repo=createNotificationDeliveryRepository(driver,ports);let result;
  if(b.method==='enqueue')result=await repo.enqueueNotice(await buildEnqueueNoticeCommand({principal,requestKey:b.requestKey,input:b.input,nowMs:b.nowMs},crypto));
  else if(b.method==='lease')result=await repo.leaseDue(principal,{limit:b.limit});else if(b.method==='finish')result=await repo.finishLease(principal,{id:b.id,lease:b.lease,outcome:b.outcome});else if(b.method==='reconcile')result=await repo.reconcileUnknown(principal,{id:b.id});
  else if(b.method==='consent')result=await createNotificationConsentRepository(driver,ports).setConsent(await buildNotificationConsentCommand({principal:{kind:'wallet',wallet:b.wallet},requestKey:b.requestKey,input:b.consent,nowMs:b.nowMs},crypto));else result=await repo.readInbox({kind:'wallet',wallet:b.wallet},{cursor:b.cursor,limit:b.limit});
  return {status:200,result,injected};
 }catch(error){return {status:500,error:injected?'synthetic-notice-fault':String(error),injected};}
}
test('actual local D1 delivery matches Node source templates, leases, unknown reconciliation, revoke and irreversible receipts',async t=>{
 const node=openDatabase();t.after(()=>node.close());const {mf,db}=await localRuntime(t,new URL('./fixtures/notification-delivery-worker.ts',import.meta.url));
 const run=async(sql,...values)=>{node.prepare(sql).run(...values);await db.prepare(sql).bind(...values).run();};
 node.exec('CREATE TABLE notification_delivery_fixture_clock(now_ms INTEGER)');await db.prepare('CREATE TABLE notification_delivery_fixture_clock(now_ms INTEGER)').run();await run('INSERT INTO notification_delivery_fixture_clock VALUES(?)',START);await run('INSERT INTO app_operator_scopes VALUES(?,?,0,1)',principal.id,'notification-work');
 for(let n=1;n<=4;n++)await run('INSERT INTO market_fixtures VALUES(?,?,?,?,?)',n,'synthetic-market-'+n,'mint-'+n,'pool-'+n,JSON.stringify({activatedAt:new Date(START).toISOString()}));
 await run('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)','synthetic-ballot',START,START+DAY,START-7*DAY,'a'.repeat(64),1);await run('INSERT INTO genesis_voters VALUES(?,?)','synthetic-ballot',wallet);
 await run('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)','synthetic-token',START-10*DAY,'10000');await run('INSERT INTO earn_boards VALUES(?,?,?,?,?)',Math.floor(START/DAY),'[]',START,'a'.repeat(64),'synthetic-notice-source');await run('INSERT INTO earn_allocations VALUES(?,?,?,?,?,?,?,?)','synthetic-token',1,Math.floor(START/DAY),START-1000,START-1,START+10000,'10','0');await run('INSERT INTO earn_awards VALUES(?,?,?,?)','synthetic-token',1,wallet,'10');
 const tables=['notice_preferences','notice_consent_requests','notice_outbox','notice_inbox','app_command_receipts'],metrics=[];let calls=0;
 const snap=async()=>canonicalJson(await Promise.all(tables.map(async name=>[name,(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results]))),nodeSnap=()=>canonicalJson(tables.map(name=>[name,node.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
 const both=async(extra={})=>{const b={method:'enqueue',wallet,requestKey:'enqueue-launch',input:{wallet,topic:'launch',subject:'synthetic-market-1'},nowMs:START,idPrefix:'synthetic-delivery-'+(++calls),...extra},n=await nodeCall(node,b),response=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(b)}),d=await response.json();assert.equal(response.status,200);assert.equal(d.status,n.status,JSON.stringify({n,d}));assert.equal(d.injected,n.injected);if(n.status===200)assert.deepEqual(d.result,n.result);else assert.equal(d.error,n.error);assert.equal(await snap(),nodeSnap());metrics.push(d.metrics);return d;};
 for(const w of [wallet,other])assert.equal((await both({method:'consent',wallet:w,requestKey:'enable',consent:{channel:'local-inbox',enabled:true,topics:['launch','voting','rewards'],terms:NOTICE_TERMS,expectedRevision:0}})).result.appliedRevision,1);
 for(const fault of ['omit-outbox','alter-template']){const before=await snap(),out=await both({fault});assert.equal(out.status,500);assert.equal(await snap(),before);}
 assert.equal((await both({fault:'expire'})).result.code,'revision_conflict');assert.equal((await both({fault:'source-race'})).result.code,'revision_conflict');await run('UPDATE market_fixtures SET body=? WHERE id=?',JSON.stringify({activatedAt:new Date(START).toISOString()}),'synthetic-market-1');
 assert.equal((await both({fault:'revoke-worker'})).result.code,'revision_conflict');assert.equal((await both()).result.code,'operator_scope_required');await run('UPDATE app_operator_scopes SET enabled=1 WHERE operator=?',principal.id);
 const queued=await both({fault:'lost-enqueue'});assert.equal(queued.result.state,'queued');assert.equal(queued.result.replay,true);
 assert.equal((await both({input:{wallet,topic:'voting',subject:'synthetic-ballot'},requestKey:'enqueue-voting'})).result.state,'queued');assert.equal((await both({input:{wallet,topic:'rewards',subject:{tokenId:'synthetic-token',day:1}},requestKey:'enqueue-rewards'})).result.state,'queued');assert.equal((await both({input:{wallet,topic:'launch',subject:'synthetic-market-2'},requestKey:'cap'})).result.reason,'daily-cap');
 const leases=(await both({method:'lease'})).result;assert.equal(leases.length,3);assert.deepEqual((await both({method:'lease'})).result,[]);
 for(const fault of ['omit-inbox','omit-delivered']){const before=await snap(),out=await both({method:'finish',...leases[0],fault});assert.equal(out.status,500);assert.equal(await snap(),before);}
 assert.equal((await both({method:'finish',...leases[0],fault:'lost-delivery'})).result.state,'delivered');assert.equal((await both({method:'finish',...leases[0]})).result.state,'delivered');
 assert.equal((await both({method:'finish',...leases[1],outcome:'unknown'})).result.state,'unknown');assert.equal((await both({method:'finish',...leases[2],nowMs:START+30000})).result.state,'fenced');assert.deepEqual((await both({method:'lease',nowMs:START+30000})).result,[]);
 await run("INSERT INTO ops_scope_log VALUES('synthetic-pause','optional-notifications',1,NULL,?,'fixture','pause','fixture','pause')",START+30000);assert.equal((await both({method:'reconcile',id:leases[1].id,nowMs:START+30001})).result.state,'retry');assert.deepEqual((await both({method:'lease',nowMs:START+30001})).result,[]);
 const inbox=(await both({method:'inbox',nowMs:START+30001})).result;assert.equal(inbox.items.length,1);assert.equal((await both({method:'inbox',wallet:other})).result.items.length,0);
 assert.equal((await both({method:'consent',requestKey:'revoke',nowMs:START+30002,consent:{channel:'local-inbox',enabled:false,topics:[],terms:NOTICE_TERMS,expectedRevision:1}})).result.preference.enabled,false);await run('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?',principal.id);
 assert.equal((await both({method:'finish',...leases[0],nowMs:START+30003})).result.state,'delivered');assert.equal((await both({method:'inbox',nowMs:START+30003})).result.items.length,0);
 const receipts=node.prepare('SELECT input_json FROM app_command_receipts WHERE operation_kind IN (?,?)').all(ENQUEUE_NOTICE,DELIVER_NOTICE);assert.ok(receipts.every(r=>!Object.hasOwn(JSON.parse(r.input_json),'message')&&!Object.hasOwn(JSON.parse(r.input_json),'title')&&!Object.hasOwn(JSON.parse(r.input_json),'lease')));
 await run('DELETE FROM notice_outbox');const missing=await both();assert.equal(missing.result.reason,'notice-history-unavailable');assert.equal(missing.result.replay,true);
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);assert.ok(metrics.every(m=>m.statements<=64&&m.maxBatchBytes<=262144&&m.maxParameters<=100&&m.maxResultBytes<=1048576));t.diagnostic(JSON.stringify({pairedCalls:calls,maxSql:Math.max(...metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxParameters:Math.max(...metrics.map(m=>m.maxParameters)),maxResultBytes:Math.max(...metrics.map(m=>m.maxResultBytes)),externalTransport:false}));
});
