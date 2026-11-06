import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createCollectionStateCodec} from '../../collect/state-codec.mjs';
import {collectionSourceTestDispatch,COLLECTION_TEST_OPERATOR} from '../../collect/source-test-harness.mjs';
import {createInventory,publishStage,admitMint} from '../../domain/collections/inventory.mjs';
import {encode58} from '../../server/base58.mjs';
import {canonicalJson,utf8} from '../../security/canonical.mjs';
const crypto=createNodeCrypto();
async function fixture(){
 const wallets=Array.from({length:101},(_,i)=>{const b=new Uint8Array(32).fill(127);new DataView(b.buffer).setUint32(28,i);return encode58(b);}).sort();
 let state=createInventory({id:'synthetic-source-import',kind:'genesis',tranche:1});
 for(let n=0;n<2;n++)state=publishStage(state,{id:'stage-'+n,type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets,walletLimit:1});
 for(let n=0;n<101;n++)state=admitMint(state,{operationId:'synthetic-op-'+n,wallet:wallets[n],stageId:'stage-0',at:180000000,drawCommitment:'synthetic-commit-'+n,costLamports:5000n});
 return createCollectionStateCodec({crypto}).encodeReferenceInventory(state);
}
test('private collection record/list/root intake has Node/D1 parity, bounded batches, immutable replay and mandatory-child rollback',async t=>{
 const node=openDatabase();t.after(()=>node.close());const edge=await localRuntime(t,new URL('./fixtures/collection-source-worker.ts',import.meta.url));
 node.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(COLLECTION_TEST_OPERATOR.id,'collection-import');
 await edge.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(COLLECTION_TEST_OPERATOR.id,'collection-import').run();
 const bundle=await fixture(),log=[];
 const nodeCall=request=>collectionSourceTestDispatch({driver:createNodeAtomicDriver(node),crypto,ids:{next:randomUUID},request});
 const edgeCall=async request=>(await (await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify(request)})).json());
 const both=async request=>{
  const a=await nodeCall(request),b=await edgeCall(request);assert.equal(a.status,b.status,JSON.stringify([a,b]));
  if(a.status===200){assert.equal(a.result.kind,b.result.kind);if(a.result.value)assert.deepEqual(a.result.value,b.result.value);else assert.deepEqual(a.result,b.result);}
  else assert.match(a.error,new RegExp(request.fault==='omit-child'?'Missing':'.+'));
  for(const r of [a,b]){assert.ok(r.metrics.maxBatchBytes<=262144);assert.ok(r.metrics.maxParameters<=100);assert.ok(r.metrics.statements<1000);log.push(r.metrics);}
  return [a,b];
 };
 const count=async table=>{const a=node.prepare('SELECT COUNT(*) n FROM '+table).get().n,b=await edge.db.prepare('SELECT COUNT(*) n FROM '+table).first('n');assert.equal(a,b);return a;};
 const stage=(record,fields={})=>both({method:'stage',record:{...record,bytes:[...record.bytes]},key:record.id,...fields});
 const success=(values,kind='committed')=>values.forEach(v=>{assert.equal(v.status,200,JSON.stringify(v));assert.equal(v.result.kind,kind,JSON.stringify(v));});
 success(await stage(bundle.root));assert.equal(await count('app_collection_source_seals'),0);assert.equal(await count('collect_inventories'),0);
 (await both({method:'seal-source',id:bundle.root.id,key:'seal-source'})).forEach(r=>assert.equal(r.status,500));
 const manifest=bundle.listManifests[0];success(await stage(manifest));
 (await both({method:'seal-list',id:manifest.id,key:'seal-list'})).forEach(r=>assert.equal(r.status,500));
 success(await stage(bundle.pages[0],{fault:'lost-response'}),'replayed');
 const before=await count('app_command_receipts');
 (await stage(bundle.pages[1],{fault:'omit-child'})).forEach(r=>assert.equal(r.status,500));assert.equal(await count('app_command_receipts'),before);
 const request={method:'stage',record:{...bundle.pages[1],bytes:[...bundle.pages[1].bytes]},key:bundle.pages[1].id};
 for(const call of [nodeCall,edgeCall]){const outcomes=await Promise.all([call(request),call(request)]);assert.deepEqual(outcomes.map(r=>r.result.kind).sort(),['committed','replayed']);}
 for(const page of bundle.pages.slice(2))success(await stage(page));
 (await both({method:'forged-list',id:manifest.id,key:'forged-list'})).forEach(r=>{assert.equal(r.status,500);assert.match(r.error,/Forged/);});
 (await both({method:'seal-list',id:manifest.id,key:'seal-list',fault:'omit-child'})).forEach(r=>assert.equal(r.status,500));assert.equal(await count('app_collection_list_seals'),0);
 success(await both({method:'seal-list',id:manifest.id,key:'seal-list'}));
 (await both({method:'seal-source',id:bundle.root.id,key:'seal-source',fault:'omit-child'})).forEach(r=>assert.equal(r.status,500));assert.equal(await count('app_collection_source_seals'),0);
 const seals=await both({method:'seal-source',id:bundle.root.id,key:'seal-source'});success(seals);
 assert.equal(seals[0].result.value.semanticStateDigestVerified,false);assert.equal(seals[0].result.value.provenanceVerified,false);assert.equal(seals[0].result.value.economicsVerified,false);
 for(const db of [node,edge.db]){
  const s=db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE scope='collection-import'");await s.run();
 }
 success(await both({method:'seal-source',id:bundle.root.id,key:'seal-source'}),'replayed');success(await stage(bundle.root),'replayed');
 const different={...bundle.root,id:'0'.repeat(64)};(await stage(different,{key:'invalid-bytes'})).forEach(r=>assert.equal(r.status,500));
 (await stage(bundle.root,{key:'changed-key'})).forEach(r=>assert.equal(r.result.code,'operator_scope_required'));
 for(const db of [node,edge.db])await db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE scope='collection-import'").run();
 (await stage(bundle.root,{key:'changed-key'})).forEach(r=>assert.equal(r.result.code,'source_already_staged'));
 // Maximum-sized format-only root demonstrates bounded storage. It explicitly
 // carries unapproved terms and cannot become an authoritative collection.
 const body=JSON.parse(new TextDecoder().decode(bundle.root.bytes));body.stages[0].terms.syntheticUnapprovedPadding='x'.repeat(120000);
 const bytes=utf8(canonicalJson(body)),large={id:await crypto.sha256(bytes),size:bytes.length,bytes};assert.ok(large.size>120000&&large.size<=131072);
 (await stage(large,{fault:'revoke'})).forEach(r=>assert.equal(r.result.kind,'conflict'));
 for(const db of [node,edge.db])await db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE scope='collection-import'").run();
 success(await stage(large));assert.equal(await count('collect_operations'),0);assert.equal(await count('tx_intents'),0);assert.equal(await count('tx_attempts'),0);
 for(const table of ['app_collection_records','app_collection_list_seals','app_collection_source_seals']){
  assert.throws(()=>node.prepare('UPDATE '+table+' SET id=id').run(),/immutable/);await assert.rejects(()=>edge.db.prepare('DELETE FROM '+table).run(),/immutable/);
 }
 const metrics={commands:log.length/2,maxStatements:Math.max(...log.map(r=>r.statements)),maxBatchBytes:Math.max(...log.map(r=>r.maxBatchBytes)),maxParameters:Math.max(...log.map(r=>r.maxParameters)),largeRecordBytes:large.size,records:await count('app_collection_records'),listSeals:await count('app_collection_list_seals'),sourceSeals:await count('app_collection_source_seals'),activeInventories:0,financialExecution:false};
 console.log('B11 source intake '+JSON.stringify(metrics));
});
