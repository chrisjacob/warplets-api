import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryFixture} from './fixtures.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {createNotificationDeliveryRepository} from '../storage/notification-delivery.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {buildNotificationConsentCommand,NOTICE_TERMS} from '../notifications/consent.mjs';
import {buildEnqueueNoticeCommand} from '../notifications/delivery-plan.mjs';
import {encode58} from '../server/base58.mjs';
const DAY=86400000,principal={kind:'operator',id:'synthetic-guarded-notice-recovery'},wallet=encode58(new Uint8Array(32).fill(121)),other=encode58(new Uint8Array(32).fill(122));
test('genuine guarded notification receipts survive full private V2 restore, revocation and old lease replay without recreating inbox',async t=>{
 const f=await recoveryFixture();t.after(()=>f.db.close());f.now=Date.now();f.clock={nowMs:()=>f.now};f.db.function('v2_fixture_clock',()=>f.now);f.driver={...f.driver,leaseNowSql:'v2_fixture_clock()'};
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'notification-work');
 for(let i=1;i<=3;i++)f.db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(900+i,'synthetic-guarded-market-'+i,'synthetic-mint-'+i,'synthetic-pool-'+i,JSON.stringify({activatedAt:new Date(f.now).toISOString()}));
 const consent=createNotificationConsentRepository(f.driver,f),delivery=createNotificationDeliveryRepository(f.driver,f),enable={channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0};
 const commands=[];for(const w of [wallet,other]){const command=await buildNotificationConsentCommand({principal:{kind:'wallet',wallet:w},requestKey:'synthetic-enable',input:enable,nowMs:f.now},f.crypto);commands.push(command);assert.equal((await consent.setConsent(command)).appliedRevision,1);}
 const queued=[];for(const [w,n]of [[wallet,1],[other,1],[other,2],[other,3]]){const command=await buildEnqueueNoticeCommand({principal,requestKey:'synthetic-'+w+'-'+n,input:{wallet:w,topic:'launch',subject:'synthetic-guarded-market-'+n},nowMs:f.now},f.crypto),result=await delivery.enqueueNotice(command);assert.equal(result.state,'queued');queued.push(result);}
 const leases=await delivery.leaseDue(principal),a=leases.find(l=>l.id===queued[0].id),b=leases.find(l=>l.id===queued[1].id),live=leases.find(l=>l.id===queued[2].id),retry=leases.find(l=>l.id===queued[3].id);assert.equal(leases.length,4);
 assert.equal((await delivery.finishLease(principal,a)).state,'delivered');assert.equal((await delivery.finishLease(principal,b)).state,'delivered');assert.equal((await delivery.finishLease(principal,{...retry,outcome:'retryable'})).state,'retry');
 f.now++;const revoke=await buildNotificationConsentCommand({principal:{kind:'wallet',wallet},requestKey:'synthetic-revoke',input:{...enable,enabled:false,topics:[],expectedRevision:1},nowMs:f.now},f.crypto);assert.equal((await consent.setConsent(revoke)).appliedRevision,2);
 const tables=['notice_preferences','notice_consent_requests','notice_inbox','app_command_receipts'],before=Object.fromEntries(tables.map(name=>[name,f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])),oldOutbox=f.db.prepare('SELECT * FROM notice_outbox ORDER BY id').all();
 assert.equal(before.app_command_receipts.filter(r=>r.operation_kind==='notifications.set-consent.v1').length,3);assert.equal(before.app_command_receipts.filter(r=>r.operation_kind==='notifications.enqueue.v1').length,4);assert.equal(before.app_command_receipts.filter(r=>r.operation_kind==='notifications.deliver.v1').length,2);
 const v2Codec=createRecoveryV2Codec(f),capture=createRecoveryV2Capture({...f,v2Codec,artifacts:f.store});let captured=await capture.start({captureId:'synthetic-guarded-notice-capture',sourceCommit:'a'.repeat(40)});
 for(let i=0;i<5000&&captured.kind!=='captured';i++){assert.ok(['started','progress','replayed'].includes(captured.kind),JSON.stringify(captured));captured=await capture.step({captureId:captured.captureId,expectedRevision:captured.revision});}assert.equal(captured.kind,'captured');
 const target=v2RestoreTarget(t,{...f,v2Codec,captured},{faults:['lost-final-ack']}),result=await target.drive();assert.equal(result.kind,'restored',JSON.stringify(result));assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'ready');assert.equal(target.injected.has('lost-final-ack'),true);
 for(const table of tables)assert.deepEqual(target.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),before[table],table);
 assert.deepEqual(target.db.prepare('SELECT * FROM notice_outbox ORDER BY id').all(),oldOutbox.map(row=>row.state==='leased'?Object.assign(Object.create(null),row,{state:'unknown',lease:null,lease_until_ms:null}):row));
 const ports={...f,clock:{nowMs:()=>f.now}},restoredDelivery=createNotificationDeliveryRepository(target.driver,ports),restoredConsent=createNotificationConsentRepository(target.driver,ports);
 assert.equal((await restoredDelivery.finishLease(principal,live)).state,'fenced');assert.equal(target.db.prepare('SELECT ready_ms FROM notice_outbox WHERE id=?').get(retry.id).ready_ms,oldOutbox.find(r=>r.id===retry.id).ready_ms);
 target.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);const replaySnapshot=()=>JSON.stringify(tables.map(table=>[table,target.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])),unchanged=replaySnapshot();
 const oldEnable=await restoredConsent.setConsent({...commands[0],nowMs:f.now+31*DAY});assert.equal(oldEnable.replay,true);assert.equal(oldEnable.appliedRevision,1);assert.equal(oldEnable.preference.enabled,false);assert.equal(oldEnable.preference.revision,2);
 assert.deepEqual(await restoredDelivery.finishLease(principal,a),{state:'delivered',id:a.id});assert.equal(replaySnapshot(),unchanged);assert.equal((await restoredDelivery.readInbox({kind:'wallet',wallet})).items.length,0);assert.deepEqual((await restoredDelivery.readInbox({kind:'wallet',wallet:other})).items.map(item=>item.id),[b.id]);
 assert.ok(target.metrics.every(m=>m.sql+m.objectReads+m.objectWrites<=64&&m.maxBatchBytes<=262144));t.diagnostic(JSON.stringify({guardedConsentReceipts:3,guardedEnqueueReceipts:4,guardedDeliveryReceipts:2,restoreSteps:target.metrics.length,maxOperations:Math.max(...target.metrics.map(m=>m.sql+m.objectReads+m.objectWrites)),maxBatchBytes:Math.max(...target.metrics.map(m=>m.maxBatchBytes)),readyMsRetained:true,oldLeaseFenced:true,revokedReplayNoInbox:true,externalTransport:false,financialExecution:false}));
});
