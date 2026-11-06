import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {createRecoveryLegacyEconomicStageReader} from './v2-legacy-economic-stage.mjs';

test('economic stage mapping requires exact previously completed original-stage proof and actual membership',async t=>{
 for(const profile of ['mixed','public']){
  const f=await recoveryLegacyAdoptionSource(t,{profile,settleAll:true}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-legacy-adoption-stages'})).phase,'reconcile-legacy-adoption-stages');
  const certificate=(await hashLegacyAdoptionCertificate(target.db.prepare('SELECT * FROM app_collection_legacy_adoptions').get(),f.crypto)).body,anchor=JSON.parse(target.db.prepare('SELECT body_json FROM app_collection_legacy_mint_anchors ORDER BY ordinal LIMIT 1').get().body_json),state=target.db.prepare('SELECT generation FROM app_recovery_state').get();
  const input={certificate,anchor,restoreId:f.captured.digest,pin:{generation:state.generation,watermark:target.checkpoint().targetWatermark},retainedBytes:267264},fault={kind:null};
  const driver={...target.driver,async batch(statements){const result=await target.driver.batch(statements);for(let n=0;n<statements.length;n++)if(statements[n].sql.includes('FROM app_recovery_reconcile_checks')){if(fault.kind==='missing-proof')result[n]={...result[n],rows:[]};if(fault.kind==='wrong-proof'&&result[n].rows[0])result[n].rows[0].result_digest='a'.repeat(64);}return result;}},artifacts={async getVerified(identity){if(fault.kind==='missing-original')return {status:'missing'};const r=await target.store.getVerified(identity);if(fault.kind==='mutation')target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();return r;}},reader=createRecoveryLegacyEconomicStageReader({driver,crypto:f.crypto,artifacts});
  assert.equal((await reader.read(input)).kind,'held');
  while(target.checkpoint().legacyAdoption.stageIndex<certificate.stageCount)assert.equal((await target.call('step')).kind,'progress');
  let result=await reader.read(input);assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.stageAudit.stageId,anchor.operation.stageId);assert.equal(result.readiness,false);assert.equal(result.membership===null,profile==='public');if(result.membership){assert.equal(result.membership.page.id,anchor.membership.pageId);assert.ok(JSON.parse(new TextDecoder().decode(result.membership.page.bytes)).entries.includes(anchor.operation.wallet));}
  const metrics=result.metrics;assert.ok(metrics.workingBytes<=1048576&&metrics.sql+metrics.objects<=64);
  for(const kind of ['missing-proof','wrong-proof','missing-original']){fault.kind=kind;result=await reader.read(input);assert.equal(result.kind,'held',kind+': '+JSON.stringify(result));}
  fault.kind='mutation';result=await reader.read(input);assert.equal(result.kind,'held');assert.match(result.reason,/target-changed/);
  t.diagnostic(JSON.stringify({profile,genuineStageCompletion:true,readiness:false,metrics}));
 }
});
