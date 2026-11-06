import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {freeCutFixture} from '../../collect/free-cut-test-fixture.mjs';
import {dispatchMintReservation} from '../../collect/mint-test-harness.mjs';
import {governanceWallets} from '../../governance/operator-test-fixture.mjs';
test('actual D1 free mint preserves fixed-cut admission, mandatory rollback, races and accepted replay',async t=>{
 const f=await freeCutFixture(t);await f.stage();const b=await f.begin();assert.equal((await f.page(b.value.attemptId)).kind,'committed');assert.equal((await f.seal(b.value.attemptId)).kind,'committed');
 const {mf,db}=await localRuntime(t,new URL('./fixtures/collection-mint-worker.ts',import.meta.url));
 for(const table of ['app_operator_scopes','app_command_receipts','app_collection_records','app_collection_list_seals','app_collection_eligibility_pages','collect_inventories','app_collection_authorities','app_collection_stages','collect_operations','collect_assets','vault_assets','vault_observations','collect_observations','app_collection_cut_records','app_collection_cut_attempts','app_collection_cut_pages','app_collection_free_cuts']){
  const rows=f.db.prepare('SELECT * FROM '+table).all();for(let offset=0;offset<rows.length;offset+=20)await db.batch(rows.slice(offset,offset+20).map(row=>{const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 for(const row of f.db.prepare('SELECT * FROM app_revisions').all())await db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 const input={requestKey:'synthetic-free-mint',inventoryId:f.inventoryId,stageId:f.stageId,expectedTermsDigest:f.publication.value.termsDigest},base={principal:{kind:'wallet',wallet:f.holders[0]},input,nowMs:f.cutMs,idPrefix:'synthetic-free-mint'};let pairs=0;const metrics=[];
 const edge=async request=>(await mf.dispatchFetch('http://localhost/__fixture/mint',{method:'POST',body:JSON.stringify(request)})).json();
 const both=async patch=>{const request={...base,...patch},n=await dispatchMintReservation({driver:f.base,crypto:f.ports.crypto,request}),d=await edge(request);pairs++;assert.equal(d.status,n.status,JSON.stringify({n,d}));if(n.status===200)assert.deepEqual(d.result,n.result);else assert.equal(d.error,n.error);metrics.push(d.metrics);return d;};
 for(const fault of ['omit-operation','omit-authority','omit-admission'])assert.equal((await both({fault})).status,500);
 for(const fault of ['source-change','watermark-change'])assert.equal((await both({fault})).result.code,'revision_conflict');
 assert.equal((await both({principal:{kind:'wallet',wallet:governanceWallets(3)[2]}})).result.reason,'wallet_ineligible');
 const accepted=await both({fault:'lost-response'});assert.equal(accepted.result.kind,'replayed');assert.equal((await both({nowMs:f.cutMs+86400001})).result.kind,'replayed');
 assert.equal((await both({input:{...input,requestKey:'synthetic-second'},idPrefix:'synthetic-second'})).result.reason,'stage_wallet_limit');
 const race={...base,principal:{kind:'wallet',wallet:f.holders[1]},input:{...input,requestKey:'synthetic-race'},idPrefix:'synthetic-race'},results=await Promise.all([edge(race),edge(race)]);assert.equal(results.filter(r=>r.result?.kind==='committed').length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.result?.kind==='replayed').length,1,JSON.stringify(results));
 assert.equal(await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').first('n'),2);assert.equal(await db.prepare('SELECT COUNT(*) n FROM collect_snapshots').first('n'),0);assert.equal(await db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n'),0);
 t.diagnostic(JSON.stringify({pairedCalls:pairs,maxStatements:Math.max(...metrics.map(m=>m.statements)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxResultBytes:Math.max(...metrics.map(m=>m.maxResultBytes)),syntheticOnly:true,financialExecution:false}));
});
