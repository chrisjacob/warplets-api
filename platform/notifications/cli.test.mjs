import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {createNotificationConsentService,NOTICE_TERMS} from './consent.mjs';
import {encode58} from '../server/base58.mjs';
import {runNoticeCli} from './cli.mjs';
async function fixture(t){
 const root=fileURLToPath(new URL('../../work/',import.meta.url));mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'b13-cli-')),database=join(dir,'fixture.sqlite'),file=join(dir,'request.json');
 t.after(()=>{if(!resolve(dir).startsWith(resolve(root)+sep))throw Error('Fixture cleanup outside work directory.');rmSync(dir,{recursive:true,force:true});});
 const wallet=encode58(new Uint8Array(32).fill(29)),operatorId='synthetic-cli-worker',db=openDatabase(database),ports={crypto:createNodeCrypto(),clock:{nowMs:Date.now},ids:{next:randomUUID}};
 try{
  db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(operatorId,'notification-work');
  for(let n=1;n<=2;n++)db.prepare('INSERT INTO market_fixtures VALUES(?,?,?,?,?)').run(n,'synthetic-cli-market-'+n,'synthetic-mint-'+n,'synthetic-pool-'+n,JSON.stringify({activatedAt:new Date(Date.now()-1000).toISOString()}));
  const service=createNotificationConsentService({...ports,repository:createNotificationConsentRepository(createNodeAtomicDriver(db),ports)});
  assert.equal((await service.setConsent({kind:'wallet',wallet},{requestKey:'synthetic-enable',input:{channel:'local-inbox',enabled:true,topics:['launch'],terms:NOTICE_TERMS,expectedRevision:0}})).appliedRevision,1);
 }finally{db.close();}
 return {database,file,wallet,operatorId,async call(verb,input){writeFileSync(file,JSON.stringify(input));return runNoticeCli([database,verb,file]);}};
}
test('local CLI uses guarded worker scope, exact replay and real clock without self-grant or external delivery',async t=>{
 const f=await fixture(t),input={wallet:f.wallet,topic:'launch',subject:'synthetic-cli-market-1'},request={operatorId:f.operatorId,requestKey:'synthetic-enqueue',input};
 const enqueued=await f.call('enqueue',request);assert.equal(enqueued.externalTransport,false);assert.equal(enqueued.financialExecution,false);assert.equal(enqueued.result.state,'queued');
 const leased=await f.call('lease',{operatorId:f.operatorId,limit:1});assert.equal(leased.result.length,1);const lease=leased.result[0];
 const finished=await f.call('finish',{operatorId:f.operatorId,...lease});assert.equal(finished.result.state,'delivered');
 const db=openDatabase(f.database);try{assert.equal(db.prepare('SELECT COUNT(*) n FROM notice_inbox').get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='notifications.deliver.v1'").get().n,1);db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(f.operatorId);}finally{db.close();}
 assert.equal((await f.call('finish',{operatorId:f.operatorId,...lease})).result.state,'delivered');
 assert.equal((await f.call('enqueue',request)).result.state,'delivered');
 const denied=await f.call('enqueue',{...request,requestKey:'new-event',input:{...input,subject:'synthetic-cli-market-2'}});assert.equal(denied.result.kind,'conflict');
 await assert.rejects(f.call('enqueue',{...request,message:'not an allowed template'}),/exact/);
 await assert.rejects(f.call('lease',{operatorId:f.operatorId,now:1}),/exact/);
 const maintenance=openDatabase(f.database);try{const at=Date.now()-9*86400000;maintenance.prepare('INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('c'.repeat(64),f.wallet,'local-inbox',1,'launch','synthetic-expired','Market opened','A local ATT campaign is available.','/markets/synthetic-expired',at,at+86400000,'cancelled',0,at,null,null);}finally{maintenance.close();}
 const purged=await f.call('purge',{operatorId:f.operatorId,limit:100});assert.equal(purged.result.kind,'purged');assert.equal(purged.result.outboxRemoved,1);assert.equal(purged.result.consentRequestKeysRemoved,0);
 const restoreGrant=openDatabase(f.database);try{restoreGrant.prepare('UPDATE app_operator_scopes SET enabled=1 WHERE operator=?').run(f.operatorId);}finally{restoreGrant.close();}
 assert.equal((await f.call('enqueue',{...request,requestKey:'new-event',input:{...input,subject:'synthetic-cli-market-2'}})).result.state,'queued');
 assert.equal((await f.call('drain',{operatorId:f.operatorId,limit:1})).result[0].state,'delivered');

});
test('CLI rejects unknown verbs and overlarge local fixtures before opening a database',async t=>{
 const f=await fixture(t);await assert.rejects(runNoticeCli([f.database,'send',f.file]),/Use LOCAL_DB/);writeFileSync(f.file,' '.repeat(16385));await assert.rejects(runNoticeCli([f.database,'purge',f.file]),/bounded/);
});
