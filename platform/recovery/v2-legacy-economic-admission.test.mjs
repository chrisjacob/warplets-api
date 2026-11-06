import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {startLegacyAdmissions} from '../collect/legacy-admission-audit.mjs';
import {createRecoveryLegacyEconomicAdmissionReader} from './v2-legacy-economic-admission.mjs';

test('economic admission mapping rederives the exact accepted prepare proof using immutable original rows',async t=>{
 const f=await recoveryLegacyAdoptionSource(t),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const certificate=(await hashLegacyAdoptionCertificate(target.db.prepare('SELECT * FROM app_collection_legacy_adoptions').get(),f.crypto)).body,anchor=JSON.parse(target.db.prepare('SELECT body_json FROM app_collection_legacy_mint_anchors').get().body_json),generation=target.db.prepare('SELECT generation FROM app_recovery_state').get().generation,prefix=await startLegacyAdmissions(f.bundle.root,{crypto:f.crypto});
 const input={certificate,anchor,prefix,restoreId:f.captured.digest,pin:{generation,watermark:target.checkpoint().targetWatermark},retainedBytes:267264},fault={kind:null};
 const driver={...target.driver,async batch(statements){const result=await target.driver.batch(statements);for(let n=0;n<statements.length;n++){const sql=statements[n].sql;if(fault.kind==='missing-operation'&&sql.includes('FROM collect_operations WHERE id='))result[n]={...result[n],rows:[]};if(fault.kind==='wrong-prior'&&sql.includes('priorCount')&&result[n].rows[0])result[n].rows[0].walletStageCount++;if(fault.kind==='mutation'&&sql.includes('priorCount'))target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return result;}},reader=createRecoveryLegacyEconomicAdmissionReader({driver,crypto:f.crypto});
 let result=await reader.read(input);assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.readiness,false);assert.equal(result.operation.id,anchor.operation.id);assert.equal(result.priorFacts.ordinal,anchor.ordinal);assert.equal(result.sourceRoot.id,certificate.rootId);assert.ok(result.metrics.workingBytes<=1048576&&result.metrics.sql<=64);const metrics=result.metrics;
 for(const kind of ['missing-operation','wrong-prior']){fault.kind=kind;result=await reader.read(input);assert.equal(result.kind,'held',kind+': '+JSON.stringify(result));}
 fault.kind=null;const wrong=structuredClone(input);wrong.prefix.paid++;assert.equal((await reader.read(wrong)).kind,'held');
 fault.kind='mutation';result=await reader.read(input);assert.equal(result.kind,'held');assert.match(result.reason,/target-changed/);
 t.diagnostic(JSON.stringify({genuineAdoption:true,exactOriginalPrepareProof:true,remainingSemanticsHeld:true,metrics}));
});
