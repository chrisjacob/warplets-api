import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,measureBatch} from '../storage/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,orderedJson,utf8} from '../security/canonical.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createInventory,publishStage} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createEligibilityIndexRepository} from './eligibility-index-repository.mjs';
import {prepareCollectionIntakeCommand,prepareCollectionRecord,prepareCollectionList,prepareCollectionSource} from './source-intake.mjs';
import {prepareEligibilityIndexCommand} from './eligibility-index-service.mjs';
const kinds=['collection.stage-record.v1','collection.seal-list.v1','collection.seal-source.v1','collection.materialize-eligibility-page.v1'];
const principal={kind:'operator',id:'synthetic-source-audit'};
const snapshot=db=>canonicalJson(Object.fromEntries(['app_collection_records','app_collection_list_seals','app_collection_source_seals','app_collection_eligibility_pages','app_command_receipts','ops_config_audit','app_revisions'].map(n=>[n,db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()])));
async function fixture(t,kind=kinds[0],wrap=b=>b){
 const db=openDatabase();t.after(()=>db.close());let now=180000001;db.function('synthetic_source_audit_clock',()=>now);
 // Explicit historical local fixture clock, never a production clock override.
 const base={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_source_audit_clock()'},crypto=createNodeCrypto(),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>now}};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const wallet=encode58(new Uint8Array(32).fill(127)),state=publishStage(createInventory({id:'synthetic-source-audit',kind:'genesis',tranche:1}),{id:'first',type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:[wallet],walletLimit:1}),bundle=await createCollectionStateCodec({crypto}).encodeReferenceInventory(state);
 const clean=createCollectionSourceRepository(base,ports),command=async(k,id,key=id,expectedRevisions={})=>(k===kinds[3]?prepareEligibilityIndexCommand({principal,input:{id},requestKey:key,expectedRevisions,nowMs:now},crypto):prepareCollectionIntakeCommand(k,{principal,input:{id},requestKey:key,expectedRevisions,nowMs:now},crypto));
 const list=await prepareCollectionList({manifest:bundle.listManifests[0],pages:bundle.pages},crypto),source=await prepareCollectionSource({root:bundle.root,lists:[list],admissionPages:[]},crypto);
 if(kind!==kinds[0])for(const record of [...bundle.pages,...bundle.listManifests,bundle.root])assert.equal((await clean.stageRecord(await command(kinds[0],record.id),record)).kind,'committed');
 if(kind===kinds[2])assert.equal((await clean.sealList(await command(kinds[1],list.id),list)).kind,'committed');
 const driver=wrap(base,db,()=>now,v=>{now=v;}),repo=createCollectionSourceRepository(driver,ports),index=createEligibilityIndexRepository(driver,ports),id=kind===kinds[1]?list.id:kind===kinds[3]?bundle.pages[0].id:bundle.root.id,c=await command(kind,id,'synthetic-target');
 const run=(cmd=c,preview=false)=>kind===kinds[0]?repo[preview?'previewRecord':'stageRecord'](cmd,bundle.root):kind===kinds[1]?repo[preview?'previewList':'sealList'](cmd,list):kind===kinds[2]?repo[preview?'previewSource':'sealSource'](cmd,source):index[preview?'previewPage':'materializePage'](cmd);
 return {db,base,ports,bundle,list,source,c,run,command,setNow:v=>{now=v;}};
}

test('all source commands retain exact historical result and ordered audit; previews perform no writes',async t=>{
 for(const kind of kinds){const f=await fixture(t,kind),before=snapshot(f.db),preview=await f.run(f.c,true);assert.equal(preview.kind,'preview');assert.equal(snapshot(f.db),before);assert.deepEqual(preview.expectedRevisions,revisions(f.db.prepare('SELECT * FROM app_revisions').all()));
  const accepted=await f.run();assert.equal(accepted.kind,'committed');assert.deepEqual(preview.value,accepted.value);const r=f.db.prepare('SELECT * FROM app_command_receipts WHERE operation_id=?').get(accepted.receipt.operationId),a=f.db.prepare('SELECT * FROM ops_config_audit ORDER BY seq DESC LIMIT 1').get(),payload={operationKind:kind,requestDigest:f.c.requestDigest,resultRef:f.c.input.id,resultDigest:await f.ports.crypto.sha256(utf8(canonicalJson(accepted.value)))};
  assert.equal(r.request_digest,f.c.requestDigest);assert.equal(a.payload,orderedJson(payload));assert.equal(a.category,'collection-source');assert.equal(a.entity,f.c.businessIdentity);assert.equal(a.change_key,canonicalJson([kind,f.c.requestKey]));assert.equal(a.actor,principal.id);assert.equal(a.evidence_ref,f.c.input.id);assert.equal(a.recorded_ms,180000001);
  assert.equal(a.event_hash,await f.ports.crypto.sha256(utf8(orderedJson(['10x-local-config-audit-v1',a.seq,a.previous_hash,a.category,a.entity,a.change_key,a.recorded_ms,a.actor,a.evidence_ref,payload]))));assert.equal(JSON.parse(r.input_json).audit.eventHash,a.event_hash);verifyConfigChain(f.db);
 }
});

test('omitted or altered source audits roll back every business child and receipt',async t=>{
 for(const kind of kinds)for(const fault of ['omit','actor','payload']){let injected=false;const f=await fixture(t,kind,base=>({...base,async batch(ss){return base.batch(ss.flatMap(s=>{if(!s.sql.startsWith('INSERT INTO ops_config_audit'))return [s];injected=true;if(fault==='omit')return [];const values=[...s.values];if(fault==='actor')values[7]='synthetic-wrong';else values[9]=orderedJson({...JSON.parse(values[9]),resultDigest:'f'.repeat(64)});return [{...s,values}];}));}})),before=snapshot(f.db);await assert.rejects(f.run(),/Missing exact collection source audit/);assert.equal(injected,true);assert.equal(snapshot(f.db),before);}
});

test('source audit head race retries without forks; lost acknowledgement and revoked replay do not duplicate effects',async t=>{
 const f=await fixture(t);let count=0,release;const gate=new Promise(r=>{release=r;}),driver={...f.base,async batch(ss){const rows=await f.base.batch(ss);if(count<2&&ss.some(s=>s.sql==='SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1')){count++;if(count===2)release();await gate;}return rows;}},repo=createCollectionSourceRepository(driver,f.ports),records=[f.bundle.root,f.bundle.pages[0]],commands=await Promise.all(records.map(r=>f.command(kinds[0],r.id))),run=i=>repo.stageRecord(commands[i],records[i]),results=await Promise.all([run(0),run(1)]);assert.deepEqual(results.map(r=>r.kind).sort(),['committed','conflict']);assert.equal((await run(results.findIndex(r=>r.kind==='conflict'))).kind,'committed');assert.equal(verifyConfigChain(f.db).events,2);
 for(const kind of kinds){let lost=false;const g=await fixture(t,kind,base=>({...base,async batch(ss){const rows=await base.batch(ss);if(!lost&&ss.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){lost=true;throw Error('Synthetic lost response');}return rows;}})),accepted=await g.run();assert.equal(accepted.kind,'replayed');g.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);g.setNow(999999999);const before=snapshot(g.db),replay=await g.run();assert.deepEqual(replay,accepted);assert.equal(snapshot(g.db),before);}
});

test('reviewed revisions, scope and execution clock are fenced at commit for each source command',async t=>{
 for(const kind of kinds){const f=await fixture(t,kind),preview=await f.run(f.c,true),reviewed=await f.command(kind,f.c.input.id,f.c.requestKey,preview.expectedRevisions);f.db.prepare('UPDATE app_operator_scopes SET revision=revision+1 WHERE operator=?').run(principal.id);const before=snapshot(f.db);assert.equal((await f.run(reviewed)).code,'revision_conflict');assert.equal(snapshot(f.db),before);
  for(const fault of ['clock','scope']){let injected=false;const g=await fixture(t,kind,(base,db,now,setNow)=>({...base,async batch(ss){if(!injected&&ss.some(s=>s.sql.startsWith('INSERT INTO ops_config_audit'))){injected=true;if(fault==='clock')setNow(now()+30001);else db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);}return base.batch(ss);}})),receipts=g.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;assert.equal((await g.run()).code,'revision_conflict');assert.equal(injected,true);assert.equal(g.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,receipts);}
 }
});

test('pre061 committed plain source receipt replays without audit backfill',async t=>{
 const f=await fixture(t),v=await prepareCollectionRecord(f.bundle.root,f.ports.crypto),result={id:v.id,size:v.size,format:v.format,visibility:'private-staging'};
 // Upgrade-only fixture: remove solely the new additive guard while inserting
 // the genuine old command shape with every original mandatory child intact.
 f.db.exec('DROP TRIGGER app_collection_source_audit_mandatory');const old=await createAtomicReceipts(f.base,f.ports).execute(f.c,{businessKey:f.c.businessIdentity,input:f.c.input,result,resultRef:v.id,version:revisions(f.db.prepare('SELECT * FROM app_revisions').all()),child:(gate,p)=>sql(`INSERT INTO app_collection_records SELECT ?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,v.id,v.format,v.kind,v.pageIndex,v.size,v.bodyBase64,...p,...p)});assert.equal(old.kind,'committed');f.db.exec(readFileSync(new URL('../storage/061-collection-source-audit.sql',import.meta.url),'utf8'));f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.setNow(999999999);const before=snapshot(f.db),replay=await f.run();assert.equal(replay.kind,'replayed');assert.deepEqual(replay.value,old.value);assert.deepEqual(replay.receipt,old.receipt);assert.equal(snapshot(f.db),before);assert.equal(verifyConfigChain(f.db).events,0);
});

test('source commits use actual execution clock and stay inside unchanged batch bounds',async t=>{
 const measured=[];const f=await fixture(t,kinds[0],base=>({...base,async batch(ss){measured.push(measureBatch(ss));return base.batch(ss);}}));f.setNow(180010001);const accepted=await f.run();assert.equal(accepted.kind,'committed');assert.equal(f.db.prepare('SELECT created_ms FROM app_command_receipts WHERE operation_id=?').get(accepted.receipt.operationId).created_ms,180010001);const maxBatchBytes=Math.max(...measured.map(m=>m.batchBytes));assert.ok(maxBatchBytes<=262144);t.diagnostic(JSON.stringify({maxBatchBytes,maxStatements:Math.max(...measured.map(m=>m.statements))}));
});
