import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {legacyMintAuditFixture} from './legacy-mint-audit.fixtures.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createLegacyMintSource} from './legacy-mint-source.mjs';
export async function mintSourceFixture(t,options={}){
 const f=await legacyMintAuditFixture(t,options),driver=createNodeAtomicDriver(f.db),crypto=f.ports.crypto;
 const row=f.db.prepare('SELECT * FROM collect_inventories WHERE id=?').get(f.inventoryId),state=JSON.parse(row.state,(k,v)=>v&&typeof v==='object'&&Object.hasOwn(v,'$lamports')?BigInt(v.$lamports):v),bundle=await createCollectionStateCodec({crypto}).encodeReferenceInventory(state);
 const principal={kind:'operator',id:'synthetic-mint-source'};f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const intake=createCollectionSourceIntake({repository:createCollectionSourceRepository(driver,{crypto,ids:{next:randomUUID}}),crypto,clock:{nowMs:()=>Date.now()}});
 for(const record of [bundle.root,...bundle.listManifests,...bundle.pages])assert.ok(['committed','replayed'].includes((await intake.stageRecord(principal,{record,requestKey:record.id})).kind));
 for(const list of bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');assert.equal((await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id})).kind,'committed');
 const source=()=>({inventoryId:f.inventoryId,sourceRevision:String(f.db.prepare('SELECT revision FROM collect_inventories WHERE id=?').get(f.inventoryId).revision),generation:f.db.prepare('SELECT generation FROM app_recovery_state').get().generation,watermark:f.db.prepare('SELECT revision FROM app_recovery_watermark').get().revision});
 return {...f,driver,crypto,bundle,source,request:(ordinal=0)=>({rootId:bundle.root.id,ordinal,pageIndex:0,entryIndex:ordinal,source:source()}),service:createLegacyMintSource({driver,crypto})};
}
