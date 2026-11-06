import {changeScope,recordUsage} from '../operations/controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedAdoptionFixture,adoptionPrincipal} from './legacy-adoption-activation.fixtures.mjs';
import {createLegacyAdoptionAuthorityReader} from './legacy-adoption-authority.mjs';
import {createLegacyAdoptionActivation} from './legacy-adoption-activation.mjs';
import {canonicalJson} from '../security/canonical.mjs';
test('genuine preparation atomically activates current receipts and historical anchors without rewriting original effects',async t=>{
 const f=await preparedAdoptionFixture(t),original=()=>canonicalJson(['collect_inventories','collect_operations','collect_assets','vault_assets','vault_observations'].map(table=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),before=original(),result=await f.activation.activate(adoptionPrincipal,f.activationInput);
 assert.equal(result.kind,'committed',JSON.stringify(result));assert.equal(result.value.admitted,1);assert.equal(result.value.executable,false);assert.equal(original(),before);
 const reader=createLegacyAdoptionAuthorityReader({driver:f.driver,crypto:f.crypto}),read=await reader.read({inventoryId:f.inventoryId,stageId:'paid',wallet:null});assert.equal(read.kind,'ready',JSON.stringify(read));
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=?").run(adoptionPrincipal.id);
 assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'replayed');assert.equal((await f.activation.activate(adoptionPrincipal,{...f.activationInput,adoptionId:'changed'})).code,'idempotency_conflict');
 assert.ok(f.metrics.every(m=>m.sql<=64&&m.maxBatchBytes<=262144&&m.workingBytes<=1048576));t.diagnostic(JSON.stringify(f.metrics));
});

const effectTables=['app_collection_authorities','app_collection_stages','app_collection_legacy_adoptions','app_collection_legacy_stage_imports','app_collection_legacy_mint_anchors','app_collection_legacy_adoption_objects'];
test('every omitted activation child and parent finalization rolls back all promoted state',async t=>{
 for(const target of ['INSERT INTO app_collection_legacy_adoptions','INSERT INTO app_collection_authorities','INSERT INTO app_command_receipts','INSERT INTO app_collection_stages','INSERT INTO app_collection_legacy_stage_imports','INSERT INTO app_collection_legacy_mint_anchors','INSERT INTO app_collection_legacy_adoption_objects','child-commit','parent-commit']){
  const f=await preparedAdoptionFixture(t),before=f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n;let hit=false;
  const driver={...f.activationPorts.driver,async batch(statements){if(!hit&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_legacy_adoptions'))){hit=true;statements=statements.map((s,index)=>{const skip=target==='child-commit'?s.sql.startsWith("UPDATE app_command_receipts SET state='committed' WHERE operation_id IN"):target==='parent-commit'?s.sql.startsWith("UPDATE app_command_receipts SET state='committed' WHERE operation_id=?"):s.sql.startsWith(target)&&index>0;return skip?{sql:'SELECT 1 omitted',values:[]}:s;});}return f.driver.batch(statements);}};
  const result=await createLegacyAdoptionActivation({...f.activationPorts,driver}).activate(adoptionPrincipal,f.activationInput);assert.equal(hit,true);assert.equal(result.kind,'conflict',target+JSON.stringify(result));
  for(const table of effectTables)assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,target+':'+table);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,before);
  assert.equal((await f.activation.activate(adoptionPrincipal,f.activationInput)).kind,'committed');
 }
});
test('accepted lost acknowledgement and competing activation resolve one stable result',async t=>{
 const f=await preparedAdoptionFixture(t);let hit=false;const driver={...f.activationPorts.driver,async batch(statements){const r=await f.driver.batch(statements);if(!hit&&statements.some(s=>s.sql.startsWith('INSERT INTO app_collection_legacy_adoptions'))){hit=true;throw Error('Synthetic lost activation acknowledgement');}return r;}};
 const service=createLegacyAdoptionActivation({...f.activationPorts,driver}),results=await Promise.all([service.activate(adoptionPrincipal,f.activationInput),f.activation.activate(adoptionPrincipal,f.activationInput)]);assert.ok(results.every(r=>['committed','replayed'].includes(r.kind)),JSON.stringify(results));assert.deepEqual(results[0].value,results[1].value);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_legacy_adoptions').get().n,1);
});
test('source, scope, schema and clock changes during certificate hashing prevent fresh activation',async t=>{
 for(const fault of ['watermark','scope','schema','clock']){
  const f=await preparedAdoptionFixture(t);let hit=false,at=f.economicPorts.clock.nowMs();const crypto={...f.crypto,async sha256(bytes){const digest=await f.crypto.sha256(bytes);if(!hit&&new TextDecoder().decode(bytes).includes('legacy-adoption-certificate-v1')){hit=true;if(fault==='watermark')f.db.exec('UPDATE app_recovery_watermark SET revision=revision+1');if(fault==='scope')f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-publication'").run(adoptionPrincipal.id);if(fault==='schema')f.db.exec('DROP TRIGGER recovery_watermark_collect_inventories_update');if(fault==='clock')at--; }return digest;}};
  const service=createLegacyAdoptionActivation({...f.activationPorts,crypto,clock:{nowMs:()=>at}});if(fault==='clock')await assert.rejects(()=>service.activate(adoptionPrincipal,f.activationInput),/clock-regressed/);else assert.equal((await service.activate(adoptionPrincipal,f.activationInput)).kind,'conflict');assert.equal(hit,true);for(const table of effectTables)assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }
});
test('empty and unadmitted prepared inventories activate without manufacturing mint anchors',async t=>{
 for(const profile of ['empty','unadmitted']){const f=await preparedAdoptionFixture(t,{profile}),r=await f.activation.activate(adoptionPrincipal,f.activationInput);assert.equal(r.kind,'committed',JSON.stringify(r));assert.equal(r.value.admitted,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_legacy_mint_anchors').get().n,0);}
});

test('fresh activation respects pre-existing current pause and budget pressure without rewriting historical decisions',async t=>{
 for(const mode of ['pause','budget','overflow']){
  const f=await preparedAdoptionFixture(t,{beforeParents(f){const atMs=f.economicInput.asOfMs;
   if(mode==='pause')changeScope(f.db,{scope:'collection-mint',paused:true,atMs,actor:adoptionPrincipal.id,reason:'Synthetic current pause',evidenceRef:'synthetic-current-control',requestKey:'synthetic-pause'});
   else for(let n=0;n<(mode==='overflow'?101:1);n++)recordUsage(f.db,{provider:'synthetic-budget-'+n,metric:'new-monthly-usd',measured:mode==='budget'?'5000000':'1',atMs,evidenceRef:'synthetic-current-budget'});
  }}),result=await f.activation.activate(adoptionPrincipal,f.activationInput);assert.equal(result.kind,'pending',JSON.stringify(result));assert.equal(result.reason,mode==='pause'?'operator-pause':mode==='budget'?'budget-limit':'adoption-operating-input-bound');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
 }
});
test('replay needs no excluded preparation tables and caller mutation during hashing cannot alter accepted identity',async t=>{
 const f=await preparedAdoptionFixture(t),principal={...adoptionPrincipal},input={...f.activationInput};let mutated=false;const crypto={...f.crypto,async sha256(bytes){const result=await f.crypto.sha256(bytes);if(!mutated){mutated=true;principal.id='different';input.adoptionId='different';input.requestKey='different';}return result;}},service=createLegacyAdoptionActivation({...f.activationPorts,crypto});assert.equal((await service.activate(principal,input)).kind,'committed');
 const driver={...f.activationPorts.driver,async batch(statements){assert.ok(statements.every(s=>!s.sql.includes('app_collection_legacy_preparations')&&!s.sql.includes('app_collection_legacy_economics')),'Accepted replay must not read excluded controls');return f.driver.batch(statements);}};assert.equal((await createLegacyAdoptionActivation({...f.activationPorts,driver}).activate(adoptionPrincipal,f.activationInput)).kind,'replayed');
});

test('a scheduled pause becoming effective during hashing prevents the final fresh claim',async t=>{
 const f=await preparedAdoptionFixture(t,{beforeParents(f){changeScope(f.db,{scope:'collection-mint',paused:true,atMs:f.economicInput.asOfMs+1000,actor:adoptionPrincipal.id,reason:'Synthetic scheduled pause',evidenceRef:'synthetic-future-control',requestKey:'synthetic-future-pause'});}});let at=f.economicPorts.clock.nowMs();
 const crypto={...f.crypto,async sha256(bytes){const digest=await f.crypto.sha256(bytes);if(new TextDecoder().decode(bytes).includes('legacy-adoption-certificate-v1'))at=f.economicInput.asOfMs+2000;return digest;}};
 const result=await createLegacyAdoptionActivation({...f.activationPorts,crypto,driver:{...f.activationPorts.driver,leaseNowSql:String(f.economicInput.asOfMs+2000)},clock:{nowMs:()=>at}}).activate(adoptionPrincipal,f.activationInput);assert.equal(result.kind,'conflict',JSON.stringify(result));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_authorities').get().n,0);
});
