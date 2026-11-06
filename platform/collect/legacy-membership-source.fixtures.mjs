import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {legacyAdmissionFixture,legacyAdmissionWallet} from './legacy-admission-audit.fixtures.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createEligibilityIndexRepository} from './eligibility-index-repository.mjs';
import {createEligibilityIndexService} from './eligibility-index-service.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createLegacyMembershipSource} from './legacy-membership-source.mjs';
export async function membershipSourceFixture(t,{members=101,type='whitelist',indexed=true}={}){
 const f=legacyAdmissionFixture(t),wallets=Array.from({length:members},(_,n)=>legacyAdmissionWallet(n+1)).sort();
 const target=f.stage('target',type,{wallets}),day=86400000,base=target.opensAt;if(type==='free'||type==='public'){f.publish(f.stage('first'));f.publish(f.stage('second','whitelist',{opensAt:base+day,closesAt:base+2*day}));target.opensAt=base+2*day;target.closesAt=base+3*day;if(type==='public'){f.publish(f.stage('prior-free','free',{opensAt:base+2*day,closesAt:base+3*day}));f.cut('prior-free',wallets);target.opensAt=base+3*day;target.closesAt=base+4*day;}}f.publish(target);if(type==='free')f.cut('target',wallets);f.admit('target',wallets.at(-1));const snapshot=await f.snapshot(),driver=createNodeAtomicDriver(f.db),principal={kind:'operator',id:'synthetic-membership-source'},ports={crypto:f.crypto,ids:{next:randomUUID},clock:{nowMs:()=>Date.now()}};
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(driver,ports)}),index=createEligibilityIndexService({...ports,repository:createEligibilityIndexRepository(driver,ports)});
 for(const record of [snapshot.bundle.root,...snapshot.bundle.listManifests,...snapshot.bundle.pages])assert.ok(['committed','replayed'].includes((await intake.stageRecord(principal,{record,requestKey:record.id})).kind));
 for(const list of snapshot.bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');assert.equal((await intake.sealSource(principal,{id:snapshot.bundle.root.id,requestKey:snapshot.bundle.root.id})).kind,'committed');
 if(indexed)for(const page of snapshot.bundle.pages)if(JSON.parse(new TextDecoder().decode(page.bytes)).kind==='eligibility')assert.equal((await index.materializePage(principal,{id:page.id,requestKey:'index-'+page.id})).kind,'committed');
 const source=()=>({inventoryId:f.inventoryId,sourceRevision:String(f.db.prepare('SELECT revision FROM collect_inventories WHERE id=?').get(f.inventoryId).revision),generation:f.db.prepare('SELECT generation FROM app_recovery_state').get().generation,watermark:f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision});
 return {...f,snapshot,driver,source,request:()=>({rootId:snapshot.bundle.root.id,ordinal:0,pageIndex:0,entryIndex:0,source:source()}),service:createLegacyMembershipSource({driver,crypto:f.crypto}),wallets};
}
