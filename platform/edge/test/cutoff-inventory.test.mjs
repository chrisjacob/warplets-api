import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createFreezeCommand,createCutoffFreezeRepository} from '../../storage/cutoff-freeze.mjs';
import {loadCutoffInventory} from '../../storage/cutoff-inventory.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {registerPosition,recordPositionEvent,reconcilePosition} from '../../earn/positions.mjs';
import {DAY_MS} from '../../domain/earn/index.mjs';
const crypto=createNodeCrypto(),epoch=20,start=epoch*DAY_MS,cutoff=start+DAY_MS-1,principal={kind:'operator',id:'cutoff-fixture'};
// Only synthetic fixture rows, copied in FK order. No receipts, revisions or
// freeze rows are copied: each runtime independently freezes the same records.
const tables=['app_operator_scopes','earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','ops_config_audit',
 'earn_submissions','earn_reviews','earn_owner_snapshots','earn_boards','earn_decisions','earn_streaks',
 'earn_position_enrollments','earn_position_events','earn_position_cutoffs'];
test('D1 cutoff inventory matches Node frozen facts, exact daily chain and101 tied late approvals; read correction rejects mixed snapshot',async t=>{
 const node=openDatabase();t.after(()=>node.close());const driver=createNodeAtomicDriver(node),query={epoch,nowMs:cutoff+1,historyStartMs:start};
 node.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'earn-snapshot');
 node.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',start,'1000000');
 const entry=recordSamplePrice(node,{wallet:'w',tokenId:'A',asOfMs:start,stakedUnits:'10000000',validUntilMs:start+100});
 node.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run('post','w','A',epoch,'https://example.test/post',start+1,entry.receipt,'fixture-key');
 node.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run('post',7,'fixture-moderator','fixture reason',start+2,'synthetic-review');
 recordSamplePrice(node,{wallet:'w',tokenId:'A',asOfMs:cutoff,stakedUnits:'10000000'});
 node.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(epoch,'w','[]','synthetic-owner');
 registerPosition(node,{wallet:'w',tokenId:'A',enrolledMs:start});
 recordPositionEvent(node,{type:'verified-buy-and-stake',signature:'synthetic-buy',instructionIndex:1,wallet:'w',tokenId:'A',sequence:1,atMs:start+1,sourceRef:'synthetic-linked-purchase',confirmed:true,
  swap:{wallet:'w',tokenId:'A',signature:'synthetic-buy',instructionIndex:0,netBoughtUnits:'10000000'},
  deposit:{wallet:'w',tokenId:'A',signature:'synthetic-buy',instructionIndex:1,depositedUnits:'10000000'}});
 reconcilePosition(node,{epoch,wallet:'w',tokenId:'A',asOfMs:cutoff,reconciledSequence:1,sourceRef:'synthetic-history'});
 node.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch-1,'[]',start,'prior-board','synthetic');
 for(let n=0;n<101;n++){
  const wallet='late'+n,read='late-read'+n,id='late-post'+n;
  node.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run(read,wallet,'A',start-2,start-1,'10000000','synthetic');
  node.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,wallet,'A',epoch-1,'https://example.test/'+n,start-1,read,'late-key'+n);
  node.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(id,7,'fixture','fixture',start+1,'synthetic');
  node.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)').run(id,epoch-1,1,read);
  node.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)').run(epoch-1,wallet,2,start-1);
 }
 const {mf,db}=await localRuntime(t,new URL('./fixtures/cutoff-inventory-worker.ts',import.meta.url));
 for(const table of tables){
  const rows=node.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),statements=[];
  for(const row of rows){const keys=Object.keys(row);statements.push(db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)));}
  for(let offset=0;offset<statements.length;offset+=100)await db.batch(statements.slice(offset,offset+100));
 }
 const call=async(action,fault)=>{const response=await mf.dispatchFetch('http://localhost/inventory',{method:'POST',body:JSON.stringify({action,query,fault})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
 assert.equal((await call('load')).reason,'admission-freeze-required');
 const freeze=await createCutoffFreezeRepository(driver,{crypto,ids:{next:randomUUID}}).freezeEpoch(await createFreezeCommand({principal,epoch,nowMs:query.nowMs},crypto));
 const d1Freeze=await call('freeze');assert.equal(freeze.kind,'committed');assert.equal(d1Freeze.kind,'committed');assert.deepEqual(d1Freeze.value,freeze.value);
 const expected=await loadCutoffInventory(driver,crypto,query),actual=await call('load');assert.equal(expected.kind,'loaded');assert.equal(actual.kind,'loaded');
 assert.deepEqual(actual.inputs,expected.inputs);assert.deepEqual(actual.walletDetails,expected.walletDetails);assert.deepEqual(actual.measurements,expected.measurements);
 assert.equal(actual.freeze.admission_digest,expected.freeze.admission_digest);assert.equal(actual.freeze.inventory_json,expected.freeze.inventory_json);
 assert.equal(actual.asOfMs,expected.asOfMs);assert.equal(actual.inputs.find(i=>i.kind==='late-approvals').value.length,101);
 assert.equal(actual.inputs.filter(i=>i.kind==='previous-board'&&i.subject.kind==='wallet').length,102);
 assert.equal(actual.walletDetails[0].chains[0].chain.status,'ready');assert.equal(actual.walletDetails[0].chains[0].chain.tokenDays,1);
 assert.deepEqual(await call('load','review-race'),{kind:'conflict',code:'revision_conflict'});
 assert.deepEqual(await call('load','journal-race'),{kind:'conflict',code:'revision_conflict'},'direct journal correction is guarded by migration028 source revisions');
 console.log('D1 inventory measured',JSON.stringify(actual.measurements));
});
