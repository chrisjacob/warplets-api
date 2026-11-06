// SQL clock below is pinned solely to this synthetic fixture's existing clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {maximumSourceBundle} from './capacity-fixtures.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createCollectionSourceIntake} from '../collect/source-intake.mjs';
import {createCollectionSourceRepository} from '../collect/source-repository.mjs';
import {createEligibilityIndexService} from '../collect/eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from '../collect/eligibility-index-repository.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createRecoveryV2IndexReader} from './v2-traversal.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
test('full32 distinct10000-member SQL source graphs, private indexes and1000 declared admissions capture without truncation',async t=>{
 const {crypto,codec,bundle,records}=await maximumSourceBundle(),db=openDatabase();t.after(()=>db.close());const base={...createNodeAtomicDriver(db),leaseNowSql:'1'},principal={kind:'operator',id:'synthetic-maximum-source'},ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>1}};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(base,ports)}),indexer=createEligibilityIndexService({...ports,repository:createEligibilityIndexRepository(base,ports)});
 for(const record of records.values())assert.equal((await intake.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');
 for(const list of bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');
 let indexPages=0;for(const page of bundle.pages){const value=await codec.verifyRecord(page);if(value.kind==='eligibility'){indexPages++;assert.equal((await indexer.materializePage(principal,{id:page.id,requestKey:page.id})).kind,'committed');}}
 const sealed=await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id});assert.equal(sealed.kind,'committed');assert.equal(sealed.value.admissionCount,1000);assert.equal(sealed.value.provenanceVerified,false);assert.equal(records.size,3245);assert.equal(indexPages,3200);assert.equal(db.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0,'Normalized record closure is not economic inventory activation.');
 const schema=await readInstalledRecoverySchema(crypto),store=memoryArtifacts(),v2Codec=createRecoveryV2Codec({crypto}),metrics=[];let current=null;
 const driver={...base,async batch(statements){current.sql+=statements.length;current.maxBatchBytes=Math.max(current.maxBatchBytes,measureBatch(statements).batchBytes);const results=await base.batch(statements);current.returnedBytes+=Buffer.byteLength(JSON.stringify(results));return results;}},artifacts={async getVerified(identity){current.reads++;const result=await store.getVerified(identity);if(result.status==='verified')current.objectBytes+=result.bytes.length;return result;},async putIfAbsent(identity,bytes){current.writes++;current.objectBytes+=bytes.length;return store.putIfAbsent(identity,bytes);}},capture=createRecoveryV2Capture({...ports,driver,artifacts,schema,v2Codec,codec:createManifestCodec({crypto})});
 const call=async(method,input)=>{current={sql:0,reads:0,writes:0,maxBatchBytes:0,returnedBytes:0,objectBytes:0};try{return await capture[method](input);}finally{metrics.push(current);current=null;}};
 let result=await call('start',{captureId:'synthetic-full-source',sourceCommit:'a'.repeat(40)});for(let n=0;n<10000&&['started','progress','replayed'].includes(result.kind);n++)result=await call('step',{captureId:result.captureId,expectedRevision:result.revision});assert.equal(result.kind,'captured',JSON.stringify(result));const root=await v2Codec.verifyRoot(result.bytes,result.digest);assert.ok(root.totals.bytes>36*1024*1024);assert.ok(result.bytes.length<16384);
 const reader=createRecoveryV2IndexReader({artifacts:store,crypto,v2Codec}),tables=[];let cursor=null;for(let n=0;n<256;n++){const next=await reader.step({kind:'tables',pointer:root.tables,cursor});if(next.kind==='done')break;if(next.kind==='entry')tables.push(next.value);cursor=next.cursor;}
 for(const [name,count] of [['app_collection_records',3245],['app_collection_eligibility_pages',3200],['app_collection_list_seals',32],['app_collection_source_seals',1],['app_command_receipts',6478]])assert.equal(tables.find(t=>t.name===name).rowCount,count,name);
 const recordTable=tables.find(t=>t.name==='app_collection_records');let found=false,rows=0;cursor=null;
 for(let n=0;n<2000;n++){const next=await reader.step({kind:'table-pages',pointer:recordTable.pages,cursor});if(next.kind==='done')break;if(next.kind==='entry'){const object=await store.getVerified(next.value.identity),page=await v2Codec.verifyRows(object.bytes,next.value.identity);rows+=page.rows.length;const idOffset=1+recordTable.columns.indexOf('id'),bodyOffset=1+recordTable.columns.indexOf('body_base64');for(const row of page.rows)if(row[idOffset]===bundle.root.id){found=true;assert.equal(row[bodyOffset],Buffer.from(bundle.root.bytes).toString('base64'));}}cursor=next.cursor;}
 assert.equal(rows,3245);assert.equal(found,true,'The complete large root survives in the paged capture.');assert.ok(metrics.every(m=>m.sql+m.reads+m.writes<=64));assert.ok(metrics.every(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes<=1024*1024));
 t.diagnostic(JSON.stringify({records:3245,indexedPages:3200,lists:32,declaredAdmissions:1000,receipts:6478,calls:metrics.length,rows:root.totals.rows,objects:root.totals.objects,bytes:root.totals.bytes,rootBytes:result.bytes.length,maxOperations:Math.max(...metrics.map(m=>m.sql+m.reads+m.writes)),maxBatchBytes:Math.max(...metrics.map(m=>m.maxBatchBytes)),maxSerializedWorkingBytes:Math.max(...metrics.map(m=>m.returnedBytes+m.objectBytes+m.maxBatchBytes)),sourceAuthority:'record-closure-only',economicActivation:false,restoreAcceptanceOutstanding:true}));
});
