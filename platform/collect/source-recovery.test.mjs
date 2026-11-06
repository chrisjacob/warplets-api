import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
import {createCollectionSourceIntake} from './source-intake.mjs';
import {createCollectionSourceRepository} from './source-repository.mjs';
import {createInventory,publishStage,admitMint} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {memoryArtifacts} from '../application/fixtures/memory-artifacts.mjs';
import {readInstalledRecoverySchema} from '../recovery/node-schema.mjs';
import {createRecoveryExporter} from '../recovery/export.mjs';
import {createPrivateRecovery} from '../recovery/restore.mjs';
const tables=['app_collection_records','app_collection_list_seals','app_collection_source_seals'];

test('private recovery retains populated collection intake and exact receipts, including a maximum-sized staged root',async t=>{
 const source=openDatabase(),target=openDatabase();t.after(()=>{source.close();target.close();});
 const crypto=createNodeCrypto(),sourceDriver=createNodeAtomicDriver(source),rawTargetDriver=createNodeAtomicDriver(target),sourceStore=memoryArtifacts(),targetStore=memoryArtifacts(),now=200000001,measurements=[];
 const targetDriver={...rawTargetDriver,async batch(statements){measurements.push(measureBatch(statements));return rawTargetDriver.batch(statements);}};
 const ports={crypto,clock:{nowMs:()=>now},ids:{next:randomUUID}},principal={kind:'operator',id:'synthetic-intake-recovery'};
 source.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'collection-import');
 const repository=createCollectionSourceRepository(sourceDriver,ports),service=createCollectionSourceIntake({...ports,repository}),codec=createCollectionStateCodec({crypto});
 const wallet=encode58(new Uint8Array(32).fill(127));let state=createInventory({id:'synthetic-intake-recovery',kind:'genesis',tranche:1});
 state=publishStage(state,{id:'first',type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:[wallet],walletLimit:1});
 state=admitMint(state,{operationId:'synthetic-op',wallet,stageId:'first',at:180000000,drawCommitment:'synthetic-draw',costLamports:5000n});
 const bundle=await codec.encodeReferenceInventory(state);
 for(const record of [...bundle.pages,...bundle.listManifests,bundle.root])assert.equal((await service.stageRecord(principal,{record,requestKey:record.id})).kind,'committed');
 assert.equal((await service.sealList(principal,{id:bundle.listManifests[0].id,requestKey:'list'})).kind,'committed');
 const sealed=await service.sealSource(principal,{id:bundle.root.id,requestKey:'source'});assert.equal(sealed.kind,'committed');
 // Format-only legal root storage must remain recoverable even when base64
 // expands one SQL row past the historical128KiB private page target.
 const body=JSON.parse(new TextDecoder().decode(bundle.root.bytes));body.stages[0].terms.syntheticUnapprovedPadding='x'.repeat(128000);
 const bytes=utf8(canonicalJson(body)),large={id:await crypto.sha256(bytes),size:bytes.length,bytes};assert.ok(large.size<=131072&&large.size>128000);
 assert.equal((await service.stageRecord(principal,{record:large,requestKey:large.id})).kind,'committed');
 source.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-import'").run(principal.id);
 source.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('synthetic-session-revoked',wallet,'http://localhost',999999999999);
 source.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,?)').run('synthetic-challenge-revoked',wallet,'http://localhost','synthetic-private-signin',999999999999,null);
 const schema=await readInstalledRecoverySchema(crypto),recoveryPorts={...ports,schema,codec:createManifestCodec({crypto})};
 const captured=await createRecoveryExporter({...recoveryPorts,driver:sourceDriver,artifacts:sourceStore,sourceCommit:'0'.repeat(40)}).capturePrivate();assert.equal(captured.kind,'captured',JSON.stringify(captured));
 for(const name of tables)assert.ok(captured.inventory.tables.find(t=>t.name===name).rowCount>0);
 const pin=captured.digest,input={inventory:structuredClone(captured.inventory),pinnedDigest:pin},missing=captured.inventory.objects[0],retained=sourceStore.objects.get(missing.key);sourceStore.objects.delete(missing.key);
 const recovery=createPrivateRecovery({...recoveryPorts,driver:targetDriver,artifacts:targetStore,sourceArtifacts:sourceStore});
 assert.equal((await recovery.restore(input)).kind,'held');assert.equal(target.prepare('SELECT status FROM app_recovery_state').get().status,'held');
 for(const name of tables){const row=source.prepare('SELECT * FROM '+name+' LIMIT 1').get(),columns=Object.keys(row);
  assert.throws(()=>target.prepare('INSERT INTO '+name+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(row)),/mutation-disabled/);
 }
 sourceStore.objects.set(missing.key,retained);const restored=await recovery.restore(input);assert.equal(restored.kind,'restored',JSON.stringify(restored));
 for(const name of [...tables,'app_command_receipts']){
  const order=name==='app_command_receipts'?'operation_id':'id',expected=source.prepare('SELECT * FROM '+name+' ORDER BY '+order).all(),actual=target.prepare('SELECT * FROM '+name+' ORDER BY '+order).all();assert.equal(canonicalJson(actual),canonicalJson(expected),name);
 }
 for(const name of ['sessions','auth_challenges']){assert.equal(target.prepare('SELECT COUNT(*) n FROM '+name).get().n,0);assert.equal(source.prepare('SELECT COUNT(*) n FROM '+name).get().n,1);}
 assert.equal(target.prepare('SELECT enabled FROM app_operator_scopes WHERE operator=?').get(principal.id).enabled,0);
 const recoveredService=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(targetDriver,ports)}),replay=await recoveredService.sealSource(principal,{id:bundle.root.id,requestKey:'source'});
 assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,sealed.receipt);assert.deepEqual(replay.value,sealed.value);assert.equal(replay.value.verification,'record-closure-only');
 assert.equal(target.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0);assert.equal(target.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);assert.equal((await recovery.restore(input)).kind,'replayed');
 const maxRestoreBatchBytes=Math.max(...measurements.map(m=>m.batchBytes));assert.ok(maxRestoreBatchBytes<=262144);assert.ok(Math.max(...measurements.map(m=>m.statements))<1000);
 t.diagnostic(JSON.stringify({tables:captured.inventory.tables.length,populatedIntakeTables:tables.length,records:source.prepare('SELECT COUNT(*) n FROM app_collection_records').get().n,receipts:source.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,largeRootBytes:large.size,maxPrivatePageBytes:Math.max(...captured.inventory.objects.map(o=>o.size)),maxRestoreBatchBytes,authRowsRevoked:2}));
});
