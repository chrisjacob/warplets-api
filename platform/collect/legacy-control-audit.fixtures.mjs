import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {legacyAdmissionFixture,LEGACY_ADMISSION_FIXTURE_START as START,DAY} from './legacy-admission-audit.fixtures.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createLegacyControlAudit} from './legacy-control-audit.mjs';
export {START,DAY};
export function legacyControlFixture(t){
 const f=legacyAdmissionFixture(t);f.publish(f.stage('control-stage','whitelist',{closesAt:START+10*DAY}));const operation=f.admit('control-stage').operation,driver=createNodeAtomicDriver(f.db),principal={kind:'operator',id:'synthetic-control-auditor'},ports={crypto:f.crypto,ids:{next:randomUUID},clock:{nowMs:()=>START+20*DAY}};
 async function seal({sealSource=true}={}){f.db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const snapshot=await f.snapshot(),bundle=snapshot.bundle,intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(driver,ports)});for(const record of [...bundle.pages,...bundle.listManifests,bundle.root])assert.ok(['committed','replayed'].includes((await intake.stageRecord(principal,{record,requestKey:record.id})).kind));for(const list of bundle.listManifests)assert.ok(['committed','replayed'].includes((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind));if(sealSource)assert.ok(['committed','replayed'].includes((await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id})).kind));return {snapshot,bundle,input:pin(bundle.root.id)};}
 function pin(rootId){const source=f.db.prepare('SELECT r.generation,w.revision watermark FROM app_recovery_state r CROSS JOIN app_recovery_watermark w WHERE r.id=1 AND w.id=1').get(),header=f.db.prepare('SELECT revision FROM collect_inventories WHERE id=?').get(f.inventoryId),op=f.db.prepare('SELECT created_ms FROM collect_operations WHERE id=?').get(operation.id);return {rootId,operationId:operation.id,atMs:op.created_ms,source:{inventoryId:f.inventoryId,sourceRevision:String(header.revision),generation:source.generation,watermark:source.watermark}};}
 return {...f,operation,driver,ports,seal,pin,service:createLegacyControlAudit({driver,crypto:f.crypto})};
}
