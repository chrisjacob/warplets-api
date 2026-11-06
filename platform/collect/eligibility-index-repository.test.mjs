import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createEligibilityIndexRepository} from './eligibility-index-repository.mjs';
import {createEligibilityIndexService} from './eligibility-index-service.mjs';
import {encode58} from '../server/base58.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-indexer'},wallets=Array.from({length:101},(_,n)=>{const b=Buffer.alloc(32,127);b.writeUInt32BE(n,28);return encode58(b);}).sort();
async function fixture(t,wrap=base=>base){
 const db=openDatabase();t.after(()=>db.close());db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 // Explicit historical SQL clock for this synthetic fixture.
 const base={...createNodeAtomicDriver(db),leaseNowSql:'180000001'},ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>180000001}},intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(base,ports)}),bundle=await createCollectionStateCodec({crypto}).encodeWalletList(wallets);
 for(const record of [bundle.manifest,...bundle.pages])assert.equal((await intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');
 const repository=createEligibilityIndexRepository(wrap(base,db),ports),service=createEligibilityIndexService({...ports,repository});
 return {db,base,bundle,service,intake,count:table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n,materialize:(n=0,key='index-'+n)=>service.materializePage(principal,{id:bundle.pages[n].id,requestKey:key})};
}
test('eligibility index derives exact bounded members from retained bytes and retains replay after scope revocation',async t=>{
 const f=await fixture(t),results=await Promise.all([f.materialize(),f.materialize()]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);assert.equal(f.count('app_collection_eligibility_pages'),1);
 const row=f.db.prepare('SELECT * FROM app_collection_eligibility_pages').get();assert.equal(row.entry_count,100);assert.deepEqual(JSON.parse(row.entries_json),wallets.slice(0,100));assert.equal(row.record_id,f.bundle.pages[0].id);
 assert.equal((await f.materialize(0,'another')).code,'index_already_materialized');
 assert.equal((await f.service.materializePage(principal,{id:f.bundle.manifest.id,requestKey:'not-page'})).reason,'eligibility-record-invalid');
 const bytes=utf8(canonicalJson({format:'collection-page-v1',kind:'admissions',index:0,entries:[]})),admissions={id:await crypto.sha256(bytes),size:bytes.length,bytes};
 assert.equal((await f.intake.stageRecord(principal,{record:admissions,requestKey:admissions.id})).kind,'committed');assert.equal((await f.service.materializePage(principal,{id:admissions.id,requestKey:'wrong-page-kind'})).reason,'eligibility-record-invalid');
 assert.equal((await f.service.materializePage(principal,{id:'f'.repeat(64),requestKey:'missing'})).reason,'eligibility-record-missing');
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-import'").run(principal.id);assert.equal((await f.materialize()).kind,'replayed');assert.equal((await f.materialize(1)).code,'operator_scope_required');
 assert.throws(()=>f.db.prepare('UPDATE app_collection_eligibility_pages SET entries_json=?').run('[]'),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM app_collection_eligibility_pages').run(),/Retain eligibility page index/);
 assert.equal(f.count('collect_inventories'),0);assert.equal(f.count('genesis_ballots'),0);
});
test('missing index child rolls back and acknowledgement loss recovers the immutable result',async t=>{
 let omit=true;const f=await fixture(t,base=>({...base,async batch(statements){return base.batch(omit?statements.filter(s=>!s.sql.startsWith('INSERT INTO app_collection_eligibility_pages')):statements);}}));
 const before=f.count('app_command_receipts');await assert.rejects(f.materialize());assert.equal(f.count('app_collection_eligibility_pages'),0);assert.equal(f.count('app_command_receipts'),before);omit=false;assert.equal((await f.materialize()).kind,'committed');
 let lost=true;const g=await fixture(t,base=>({...base,async batch(statements){const result=await base.batch(statements);if(lost&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_eligibility_pages'))){lost=false;throw Error('Synthetic lost acknowledgement.');}return result;}}));
 assert.equal((await g.materialize()).kind,'replayed');assert.equal(g.count('app_collection_eligibility_pages'),1);assert.equal((await g.materialize()).kind,'replayed');
});
test('fresh raw-byte verification and exact indexed content reject tampering without manufacturing membership',async t=>{
 let mode='raw';const f=await fixture(t,base=>({...base,async batch(statements){const result=await base.batch(statements);for(let i=0;i<statements.length;i++){
  if(mode==='raw'&&statements[i].sql.includes('body_base64 FROM app_collection_records'))for(const row of result[i].rows)row.body_base64=btoa('x'.repeat(row.size));
  if(mode==='index'&&statements[i].sql.includes('FROM app_collection_eligibility_pages WHERE'))for(const row of result[i].rows)row.entries_json='[]';
 }return result;}}));
 assert.equal((await f.materialize()).reason,'eligibility-record-invalid');assert.equal(f.count('app_collection_eligibility_pages'),0);mode='none';assert.equal((await f.materialize()).kind,'committed');mode='index';assert.equal((await f.materialize(0,'new-command')).reason,'index-content-conflict');assert.equal((await f.materialize()).kind,'replayed');
});
test('scope is rechecked during admission and explicit empty verified page remains distinct from absent data',async t=>{
 let revoke=true;const f=await fixture(t,(base,db)=>({...base,async batch(statements){if(revoke&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_eligibility_pages'))){revoke=false;db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-import'").run(principal.id);}return base.batch(statements);}}));
 assert.equal((await f.materialize()).code,'revision_conflict');assert.equal(f.count('app_collection_eligibility_pages'),0);f.db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE operator=? AND scope='collection-import'").run(principal.id);
 const empty=await createCollectionStateCodec({crypto}).encodeWalletList([]),record=empty.pages[0];assert.equal((await f.intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');
 const accepted=await f.service.materializePage(principal,{id:record.id,requestKey:'empty'});assert.equal(accepted.kind,'committed');assert.equal(accepted.value.entryCount,0);assert.equal(f.db.prepare('SELECT entries_json FROM app_collection_eligibility_pages').get().entries_json,'[]');
});
