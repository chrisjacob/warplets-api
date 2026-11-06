import {recordUsage,reserveOptionalCost} from '../operations/controls.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLegacyAdoptionSource} from './v2-legacy-adoption-fixtures.mjs';
import {v2RestoreTarget} from './v2-restore-fixtures.mjs';
import {hashLegacyAdoptionCertificate} from '../collect/legacy-adoption-authority.mjs';
import {createRetainedLegacyControlVerifier} from './v2-legacy-admission-controls.mjs';

test('retained admission controls bind original selection and historical rows on a fresh private target',async t=>{
 const f=await recoveryLegacyAdoptionSource(t,{beforeParents(f){const at=f.db.prepare("SELECT MIN(created_ms) at FROM collect_operations WHERE kind='mint'").get().at;recordUsage(f.db,{provider:'synthetic-recovery-controls',metric:'new-monthly-usd',measured:'1000',atMs:at,evidenceRef:'synthetic-retained-usage'});reserveOptionalCost(f.db,{scope:'collection-mint',now:at,upperUsdMicros:'1',actor:'synthetic-operator',quoteRef:'synthetic-quote',requestKey:'synthetic-control-reservation'});}}),target=v2RestoreTarget(t,{...f.ports,store:f.artifacts,captured:f.captured,now:f.now});assert.equal((await target.drive({stopPhase:'reconcile-audit'})).phase,'reconcile-audit');
 const certificate=(await hashLegacyAdoptionCertificate(target.db.prepare('SELECT * FROM app_collection_legacy_adoptions').get(),f.crypto)).body,anchor=JSON.parse(target.db.prepare('SELECT body_json FROM app_collection_legacy_mint_anchors').get().body_json),state=target.db.prepare('SELECT generation FROM app_recovery_state').get(),watermark=target.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision;
 const input={certificate,anchor,pin:{generation:state.generation,watermark},retainedBytes:267264},fault={kind:null};
 const driver={...target.driver,async batch(statements){const result=await target.driver.batch(statements);if(fault.kind==='history')for(let n=0;n<statements.length;n++)if(statements[n].sql.includes('WITH selected AS')&&statements[n].sql.includes('ops_scope_log'))result[n].rows=[{count:1,body:'[{"scope":"synthetic-wrong-scope"}]'}];return result;}},artifacts={async getVerified(identity){if(fault.kind==='missing')return {status:'missing'};const r=await target.store.getVerified(identity);if(fault.kind==='corrupt'&&r.status==='verified'){const bytes=r.bytes.slice();bytes[0]^=1;return {...r,bytes};}if(fault.kind==='mutation')target.db.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();return r;}};
 const helper=createRetainedLegacyControlVerifier({driver,crypto:f.crypto,artifacts});let result=await helper.verify(input);assert.equal(result.kind,'verified',JSON.stringify(result));assert.equal(result.readiness,false);assert.deepEqual(result.controlFact,anchor.controlFact);assert.ok(result.metrics.workingBytes<=1048576);assert.equal(result.metrics.objectReads,1);
 for(const kind of ['missing','corrupt','history']){fault.kind=kind;result=await helper.verify(input);assert.equal(result.kind,'held',kind+': '+JSON.stringify(result));}
 fault.kind=null;const wrong=structuredClone(input);wrong.anchor.controlFact.paused=true;assert.equal((await helper.verify(wrong)).kind,'held');
 const mutated=structuredClone(input);let changed=false;const capturing=createRetainedLegacyControlVerifier({driver,artifacts,crypto:{sha256:async bytes=>{if(!changed){changed=true;mutated.anchor.controlFact.paused=true;mutated.pin.watermark++;}return f.crypto.sha256(bytes);}}});assert.equal((await capturing.verify(mutated)).kind,'verified');assert.equal(changed,true);
 fault.kind='mutation';result=await helper.verify(input);assert.equal(result.kind,'held');assert.match(result.reason,/target-changed/);
 assert.equal(target.db.prepare('SELECT status FROM app_recovery_state').get().status,'restoring');t.diagnostic(JSON.stringify({genuineAdoption:true,freshPrivateTarget:true,remainingSemanticsHeld:true,syntheticFixture:true}));
});
