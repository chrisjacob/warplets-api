// Synthetic local history only. Uses the genuine legacy mint/observation APIs.
import {mintSourceFixture} from './legacy-mint-source.fixtures.mjs';
import {observeCollectionAsset,createCollection,publishCollectionStage,reserveMint,fulfillMint} from './store.mjs';
import {legacyAdmissionWallet} from './legacy-admission-audit.fixtures.mjs';
import {createLegacyCurrentAssetAudit} from './legacy-current-asset-audit.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
export async function currentAssetAuditFixture(t,options={}){
 return decorate(await mintSourceFixture(t,options));
}
function decorate(f){const original=f.original[0],asOfMs=f.input().asOfMs;let n=0;
 function transfer(options={}){n++;const at=options.at??original.at+n*1000,to=options.to??legacyAdmissionWallet(100+n),current=f.db.prepare('SELECT owner FROM collect_assets WHERE id=?').get(original.assetId),event={sourceId:'synthetic-transfer-'+n+'-'+at,assetId:original.assetId,kind:'transfer',from:current.owner,to,at,finalized:true};observeCollectionAsset(f.db,event,asOfMs);return event;}
 function reveal(at=original.at+500){const event={sourceId:'synthetic-reveal',assetId:original.assetId,kind:'reveal',at,finalized:true};observeCollectionAsset(f.db,event,asOfMs);return event;}
 return {...f,asOfMs,transfer,reveal,service:createLegacyCurrentAssetAudit(f),request:(ordinal=0)=>({...f.request(ordinal),asOfMs}),closureRequest:()=>({rootId:f.bundle.root.id,source:f.source(),asOfMs})};
}
/** Genuine separate reference mint, with original unpadded traits that are also
 * accepted by the newer guarded progression validator. No history rewriting. */
export async function plainCurrentAssetAuditFixture(t){
 const db=openDatabase();t.after(()=>db.close());const inventoryId='synthetic-current-plain',start=Date.UTC(2026,0,1),open=start+2*86400000,asOfMs=open+10*86400000,wallets=[legacyAdmissionWallet(1)],crypto=createNodeCrypto(),clock={nowMs:()=>asOfMs};
 // Historical fixture setup shares one JS/SQL clock; execution-time fences retain separate coverage.
 const driver={...createNodeAtomicDriver(db),leaseNowSql:String(asOfMs)};
 createCollection(db,{id:inventoryId,kind:'season',seasonStart:start});publishCollectionStage(db,{inventoryId,stage:{id:'first',type:'whitelist',publishedAt:start,opensAt:open,closesAt:open+86400000,allocation:1000,priceLamports:'100000000',costLamports:'5000',wallets,walletLimit:1}},open);
 const reserved=reserveMint(db,{inventoryId,stageId:'first',wallet:wallets[0],requestKey:'synthetic-plain-mint',now:open}),op=db.prepare('SELECT * FROM collect_operations WHERE id=?').get(reserved.operation.id),original={operationId:op.id,assetId:'synthetic-plain-asset',proofId:'synthetic-plain-proof',at:open+1000,ticket:0,commitment:op.commitment,traits:{model:'Original',backdrop:'Space',symbol:'Moon'},finalized:true};fulfillMint(db,original,original.at);
 const raw=db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(inventoryId),state=JSON.parse(raw.state,(k,v)=>v&&typeof v==='object'&&Object.hasOwn(v,'$lamports')?BigInt(v.$lamports):v),bundle=await createCollectionStateCodec({crypto}).encodeReferenceInventory(state),principal={kind:'operator',id:'synthetic-current-source'};
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');const intake=createCollectionSourceIntake({repository:createCollectionSourceRepository(driver,{crypto,ids:{next:randomUUID},clock}),crypto,clock});
 for(const record of [bundle.root,...bundle.listManifests,...bundle.pages]){const result=await intake.stageRecord(principal,{record,requestKey:record.id});assert.equal(result.kind,'committed',JSON.stringify(result));}for(const list of bundle.listManifests)assert.equal((await intake.sealList(principal,{id:list.id,requestKey:list.id})).kind,'committed');assert.equal((await intake.sealSource(principal,{id:bundle.root.id,requestKey:bundle.root.id})).kind,'committed');
 const source=()=>({inventoryId,sourceRevision:String(db.prepare('SELECT revision FROM collect_inventories WHERE id=?').get(inventoryId).revision),generation:db.prepare('SELECT generation FROM app_recovery_state').get().generation,watermark:db.prepare('SELECT revision FROM app_recovery_watermark').get().revision});return decorate({db,inventoryId,wallets,original:[original],crypto,driver,bundle,source,request:(ordinal=0)=>({rootId:bundle.root.id,ordinal,pageIndex:0,entryIndex:ordinal,source:source()}),input:()=>({asOfMs})});
}
