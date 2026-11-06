import test from 'node:test';
import assert from 'node:assert/strict';
import {economicFixture,driveEconomics,economicPrincipal} from './legacy-economic-repository.fixtures.mjs';
import {createLegacyAdoptionPreparation} from './legacy-adoption-preparation.mjs';
import {readSchema,CONTROL_TABLES} from '../recovery/schema.mjs';
import {canonicalJson} from '../security/canonical.mjs';

test('preparation SQL retains typed closure and exact nonauthoritative result without business mutations',async t=>{
 const f=await economicFixture(t,{profile:'empty'}),economic=await driveEconomics(f,await f.economics.start(economicPrincipal,f.economicInput));assert.equal(economic.kind,'economic-ready',JSON.stringify(economic));
 const watermark=f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,schema=await readSchema(f.driver);assert.equal(schema.tables.length,117);for(const name of ['app_collection_legacy_adoptions','app_collection_legacy_stage_imports','app_collection_legacy_mint_anchors','app_collection_legacy_adoption_objects']){assert.ok(schema.tables.some(t=>t.name===name));assert.ok(!CONTROL_TABLES.includes(name));}
 for(const name of ['app_collection_legacy_preparations','app_collection_legacy_prepared_stages','app_collection_legacy_prepared_admissions','app_collection_legacy_object_candidates','app_collection_legacy_prepared_objects']){assert.ok(CONTROL_TABLES.includes(name));assert.ok(!schema.tables.some(t=>t.name===name));}
 const service=createLegacyAdoptionPreparation(f.economicPorts),input={adoptionId:'synthetic-empty-preparation-schema',economicAuditId:f.economicInput.auditId};let result=await service.start(economicPrincipal,input);assert.equal(result.kind,'started',JSON.stringify(result));
 const row=()=>f.db.prepare('SELECT * FROM app_collection_legacy_preparations WHERE id=?').get(input.adoptionId);
 const update=(sets,...values)=>f.db.prepare('UPDATE app_collection_legacy_preparations SET '+sets+',revision=revision+1,last_nonce=?,updated_ms=updated_ms+1 WHERE id=?').run(...values,'synthetic-review-'+row().revision,input.adoptionId);
 assert.throws(()=>update("phase='objects',quiescence_json=?",JSON.stringify({kind:'verified'})),/quiescence/);
 assert.throws(()=>update("state='prepared',phase='finish',result_json='{}',result_digest=?",'a'.repeat(64)),/prepared result|closure|finish|transition|quiescence/i);
 result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.phase,'objects',JSON.stringify(result));
 assert.throws(()=>update('object_cursor=1'),/effect|count/);
 assert.throws(()=>update("state='held',reason='synthetic-review',quiescence_json=NULL"),/Held preparation/);
 result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.phase,'closure',JSON.stringify(result));
 const q=JSON.parse(row().quiescence_json);
 assert.throws(()=>update("phase='finish',quiescence_json=?",JSON.stringify({current:q,objects:{count:0,expectedCount:0,totalBytes:1}})),/object closure totals/);
 const bad={...q,counts:{...q.counts,pendingOperations:null}};
 assert.throws(()=>update("phase='finish',quiescence_json=?",JSON.stringify({current:bad,objects:{count:0,expectedCount:0,totalBytes:0}})),/quiescence|transition/);
 result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.phase,'finish',JSON.stringify(result));
 const proof={format:'legacy-adoption-prepared-v1',adoptionId:input.adoptionId,economicAuditId:f.economicInput.auditId,inventoryId:f.inventoryId,rootId:f.bundle.root.id,parentDigest:row().parent_digest,preparationDigest:row().chain_digest,stageCount:0,admissionCount:0,objectCount:0,objectBytes:0,quiescenceDigest:'c'.repeat(64),preparedOnly:true,adoptionAuthorized:false,executable:false};
 for(const invalid of [{...proof,adoptionAuthorized:true},{...proof,objectCount:null},{...proof,preparedOnly:null},{...proof,extra:'unexpected'}])assert.throws(()=>update("state='prepared',result_json=?,result_digest=?",JSON.stringify(invalid),'a'.repeat(64)),/prepared result/);
 result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.kind,'prepared',JSON.stringify(result));assert.equal(result.result.executable,false);
 assert.throws(()=>update("state='held',reason='after-ready',result_json=NULL,result_digest=NULL"),/identity/);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);assert.equal(f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision,watermark);
});

test('preparation SQL rejects a verified orphan object and bounds candidate set before hydration',async t=>{
 const f=await economicFixture(t,{profile:'empty'});assert.equal((await driveEconomics(f,await f.economics.start(economicPrincipal,f.economicInput))).kind,'economic-ready');
 const service=createLegacyAdoptionPreparation(f.economicPorts),input={adoptionId:'synthetic-orphan-preparation-schema',economicAuditId:f.economicInput.auditId};let result=await service.start(economicPrincipal,input);result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.phase,'objects');
 const discovery=canonicalJson({format:'legacy-adoption-object-discovery-v1',role:'policy-part',phase:'objects',index:0,parentKey:'synthetic-nonexistent-parent'}),insert=f.db.prepare('INSERT INTO app_collection_legacy_object_candidates VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING');
 const candidate=(n,size)=>{const byteDigest=n.toString(16).padStart(64,'0');return {key:'private/'+byteDigest+'.json',byteDigest,size,semanticDigest:null,visibility:'private',contentType:'application/json'};};
 const add=identity=>insert.run(input.adoptionId,identity.key,canonicalJson(identity),discovery,'a'.repeat(64),result.revision+1);
 // Deliberately synthetic identities exercise only SQL metadata capacity;
 // none of these rows is asserted to contain verified artifact bytes.
 f.db.exec('SAVEPOINT synthetic_capacity');for(let n=1;n<=256;n++)add(candidate(n,65536));assert.throws(()=>add(candidate(257,1)),/bounded capacity/);assert.doesNotThrow(()=>add(candidate(1,65536)));f.db.exec('ROLLBACK TO synthetic_capacity; RELEASE synthetic_capacity');
 f.db.exec('SAVEPOINT synthetic_capacity');for(let n=1;n<=2048;n++)add(candidate(n,1));assert.throws(()=>add(candidate(2049,1)),/bounded capacity/);f.db.exec('ROLLBACK TO synthetic_capacity; RELEASE synthetic_capacity');
 const identity=await f.retain([]);add(identity);result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.kind,'progress',JSON.stringify(result));assert.equal(result.objectCursor,1);
 result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:result.revision});assert.equal(result.phase,'closure');
 const revision=result.revision;result=await service.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:revision});assert.equal(result.kind,'conflict',JSON.stringify(result));const row=f.db.prepare('SELECT * FROM app_collection_legacy_preparations WHERE id=?').get(input.adoptionId);assert.equal(row.revision,revision);assert.equal(row.phase,'closure');assert.equal(row.result_json,null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
});
