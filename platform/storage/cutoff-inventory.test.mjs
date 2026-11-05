import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from './cutoff-freeze.mjs';
import {loadCutoffInventory} from './cutoff-inventory.mjs';
import {buildRequirementSpecs,selectRequirementReceipts} from '../evidence/requirements.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
import {recordSamplePrice} from '../pricing/fixtures.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'cutoff-fixture'},epoch=20,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
async function setup(t,{post=true,score=7}={}){
 const db=openDatabase();t.after(()=>db.close());db.function('fixture_now',()=>cutoff+1);
 const driver={...createNodeAtomicDriver(db),leaseNowSql:'fixture_now()'};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'earn-snapshot');
 db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',start,'1000000');
 if(post){
  const entry=recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:start,stakedUnits:'10000000',validUntilMs:start+100});
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('post','w','A',epoch,'https://example.test/post',start+1,entry.receipt,'fixture-key');
  db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('post',score,'fixture-moderator','fixture reason',start+2,'synthetic-review');
  recordSamplePrice(db,{wallet:'w',tokenId:'A',asOfMs:cutoff,stakedUnits:'10000000'});
  db.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(epoch,'w','[]','synthetic-owner');
 }
 const repo=createCutoffFreezeRepository(driver,{crypto,ids:{next:randomUUID}});
 assert.equal((await repo.freezeEpoch(await createFreezeCommand({principal,epoch,nowMs:cutoff+1},crypto))).kind,'committed');
 return {db,driver,query:{epoch,nowMs:cutoff+1,historyStartMs:start}};
}
test('cutoff enumerates positive coverage, fresh entry identity and complete-empty wallet inventories',async t=>{
 const {driver,query}=await setup(t),r=await loadCutoffInventory(driver,crypto,query);assert.equal(r.kind,'loaded');
 const kinds=r.inputs.map(x=>x.kind);for(const kind of ['campaign-registry','epoch-admissions','final-review','entry-stake','closing-stake','ownership','position-inventory','late-approvals','application-history'])assert.ok(kinds.includes(kind),kind);
 const entry=r.inputs.find(x=>x.authority==='evidence'&&x.kind==='entry-stake');assert.equal(entry.cutoffMs,start);assert.equal(entry.value.status,'verified');
 assert.equal(r.inputs.find(x=>x.authority==='application'&&x.kind==='entry-stake').available,true);
 const specs=await buildRequirementSpecs(r.inputs,crypto),selection=await selectRequirementReceipts(specs,new Map(),crypto);
 assert.equal(selection.kind,'pending');assert.ok(selection.dependencies.some(x=>x.reasons.includes('source-binding-required')));
 assert.deepEqual(r.inputs.find(x=>x.kind==='ownership').value,{wallet:'w',assets:[]});
 assert.deepEqual(r.inputs.find(x=>x.kind==='position-inventory').value,{wallet:'w',positions:[]});
 assert.equal(r.asOfMs,cutoff+1);
});
test('empty board still requires positive campaign and application history coverage',async t=>{
 const {driver,query}=await setup(t,{post:false}),r=await loadCutoffInventory(driver,crypto,query);
 assert.equal(r.kind,'loaded');assert.equal(r.measurements.participants,0);
 assert.ok(r.inputs.some(x=>x.kind==='campaign-registry'));assert.ok(r.inputs.some(x=>x.kind==='application-history'));
 assert.equal((await selectRequirementReceipts(await buildRequirementSpecs(r.inputs,crypto),new Map(),crypto)).kind,'pending');
});
test('zero-score posts omit closing and wallet requirements, while entry proof remains required',async t=>{
 const {driver,query}=await setup(t,{score:0}),r=await loadCutoffInventory(driver,crypto,query);
 assert.equal(r.kind,'loaded');assert.ok(r.inputs.some(x=>x.kind==='entry-stake'));
 assert.ok(!r.inputs.some(x=>['closing-stake','ownership','position-inventory'].includes(x.kind)));
});
test('late-only approvals bind original decisions and prior streaks including same-time pages',async t=>{
 const {db,driver,query}=await setup(t,{post:false});
 db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch-1,'[]',start,'prior-board','synthetic');
 for(let n=0;n<101;n++){
  const wallet='late'+n,read='late-read'+n,id='late-post'+n;
  db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run(read,wallet,'A',start-2,start-1,'10000000','synthetic');
  db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,wallet,'A',epoch-1,'https://example.test/'+n,start-1,read,'late-key'+n);
  db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(id,7,'fixture','fixture',start+1,'synthetic');
  db.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)').run(id,epoch-1,1,read);
  db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)').run(epoch-1,wallet,2,start-1);
 }
 const r=await loadCutoffInventory(driver,crypto,query);assert.equal(r.kind,'loaded');
 assert.equal(r.inputs.find(x=>x.kind==='late-approvals').value.length,101);
 assert.equal(r.inputs.filter(x=>x.kind==='previous-board'&&x.subject.kind==='wallet').length,101);
 await buildRequirementSpecs(r.inputs,crypto);
 db.prepare('DELETE FROM earn_decisions WHERE submission_id=?').run('late-post0');
 const missing=await loadCutoffInventory(driver,crypto,query);assert.equal(missing.inputs.find(x=>x.kind==='late-approvals').available,false);
});
test('read correction rejects mixed inventory and admission freeze is mandatory',async t=>{
 const {db,driver,query}=await setup(t);let changed=false;
 const racing={...driver,async batch(statements){const r=await driver.batch(statements);
  if(!changed&&statements.some(s=>s.sql.includes('FROM price_observations'))){changed=true;db.prepare("UPDATE earn_reviews SET reason='corrected' WHERE submission_id='post'").run();}return r;}};
 assert.equal((await loadCutoffInventory(racing,crypto,query)).code,'revision_conflict');
 assert.equal((await loadCutoffInventory(driver,crypto,{...query,epoch:epoch+1,nowMs:cutoff+DAY_MS+1})).reason,'admission-freeze-required');
});
