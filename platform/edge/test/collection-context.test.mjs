import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {seedCollectionContext} from '../../application/fixtures/collection-context.mjs';
import {dispatchCollectionContext} from '../../application/fixtures/collection-context-dispatch.mjs';
import {quoteProgression} from '../../collect/store.mjs';
import {prepareProgression,applyVerifiedProgressionDraw} from '../../domain/collections/progression.mjs';

test('actual Node/D1 bounded collection contexts preserve quote parity and fail closed on concealed or conflicting current facts',async t=>{
 const node=openDatabase();t.after(()=>node.close());const f=seedCollectionContext(node),driver=createNodeAtomicDriver(node),crypto=createNodeCrypto(),edge=await localRuntime(t,new URL('./fixtures/collection-context-worker.ts',import.meta.url));
 for(const table of ['collect_inventories','vault_assets','vault_observations','collect_assets']){
  const rows=node.prepare('SELECT * FROM '+table).all();await edge.db.batch(rows.map(row=>{const keys=Object.keys(row);return edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));}));
 }
 for(const row of node.prepare('SELECT * FROM app_revisions').all())await edge.db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(row.revision,row.name).run();
 const p={kind:'wallet',wallet:f.wallet};let requests=0,maxBytes=0;
 const both=async(input={})=>{
  const value={method:'context',principal:p,input:{inventoryId:f.inventoryId,request:f.request(1)},nowMs:f.nowMs,...input},a=await dispatchCollectionContext({driver,crypto,input:value}),r=await edge.mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(value)});assert.equal(r.status,200);
  const b=await r.json();assert.deepEqual(b,a);assert.equal(a.measurements.statements,3);assert.equal(a.measurements.batches,1);requests++;maxBytes=Math.max(maxBytes,new TextEncoder().encode(JSON.stringify(a.result)).length);return a;
 };
 const write=async(sql,...values)=>{node.prepare(sql).run(...values);await edge.db.prepare(sql).bind(...values).run();};
 for(let level=1;level<=10;level++){
  const request=f.request(level,level===10?'visual':'upgrade'),value=await both({method:'quote',input:{inventoryId:f.inventoryId,request}});assert.equal(value.result.kind,'ready');
  const legacy=quoteProgression(node,{inventoryId:f.inventoryId,wallet:f.wallet,request,now:f.nowMs});assert.equal(value.quote.feeLamports,legacy.feeLamports);assert.equal(value.quote.executable,false);assert.equal(value.result.context.assets[0].ownerObservedAtMs,f.start+1000);
 }
 const initial=(await both()).result.context;assert.ok(initial.assets.every(a=>a.expiresAt<f.nowMs));
 const request={...f.request(1),operationId:'synthetic-reactivation',commitment:'synthetic-commitment',signer:f.wallet,at:f.nowMs},state={seasonId:f.inventoryId,start:f.start,assets:initial.assets.map(({inventoryId,revealStatus,ownerObservedAtMs,...a})=>a),operations:[]};
 const prepared=prepareProgression(state,request),reactivated=applyVerifiedProgressionDraw(prepared,{operationId:request.operationId,commitment:request.commitment,proofId:'synthetic-proof',at:f.nowMs,ticket:489});
 for(const asset of reactivated.assets)await write('UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=?',JSON.stringify(asset),f.nowMs,asset.id);
 const currentRequest={...f.request(1),expectedTargetVersion:2,expectedMaterialVersion:2};
 const current=await both({method:'quote',input:{inventoryId:f.inventoryId,request:currentRequest}});assert.ok(current.result.context.assets.every(a=>a.level===2&&a.expiresAt>f.nowMs));assert.equal(current.quote.feeLamports,quoteProgression(node,{inventoryId:f.inventoryId,wallet:f.wallet,request:currentRequest,now:f.nowMs}).feeLamports);
 assert.equal((await both()).result.reason,'asset-version-changed');
 const target=f.ids(2,'target'),normal=node.prepare('SELECT * FROM collect_assets WHERE id=?').get(target),contextInput={inventoryId:f.inventoryId,request:f.request(2)};
 await write('UPDATE collect_assets SET reveal_ms=NULL,asset=? WHERE id=?','{private concealed coordinate/trait sentinel',target);
 const raw=await both({method:'raw',query:{wallet:f.wallet,inventoryId:f.inventoryId,assetIds:[target],nowMs:f.nowMs}});assert.equal(raw.result.assets[0].assetJson,null);assert.doesNotMatch(JSON.stringify(raw),/sentinel|slotIndex/);assert.equal((await both({input:contextInput})).result.reason,'metadata-unrevealed');
 await write('UPDATE collect_assets SET reveal_ms=?,asset=? WHERE id=?',normal.reveal_ms,normal.asset,target);
 assert.equal((await both({principal:{kind:'wallet',wallet:f.other},input:contextInput})).result.reason,'owner-changed');
 await write('INSERT INTO vault_observations VALUES(?,?,?,?,?)','synthetic-future',target,'transfer',f.nowMs+1000,JSON.stringify({eventId:'synthetic-future',assetId:target,kind:'transfer',at:new Date(f.nowMs+1000).toISOString(),from:f.wallet,to:f.other}));assert.equal((await both({input:contextInput})).result.reason,'future-owner-observation');
 await write('DELETE FROM vault_observations WHERE event_id=?','synthetic-future');
 const ownerRow=node.prepare('SELECT * FROM vault_observations WHERE asset_id=?').get(target),badOwner={...JSON.parse(ownerRow.body),owner:f.other};await write('UPDATE vault_observations SET body=? WHERE event_id=?',JSON.stringify(badOwner),ownerRow.event_id);assert.equal((await both({input:contextInput})).result.reason,'owner-evidence-conflict');await write('UPDATE vault_observations SET body=? WHERE event_id=?',ownerRow.body,ownerRow.event_id);
 for(const [patch,reason] of [[{id:'wrong-id'},'asset-identity-or-state-mismatch'],[{expiresAt:1},'asset-expiry-mismatch'],[{pending:'synthetic-pending'},'asset-reserved']]){await write('UPDATE collect_assets SET asset=? WHERE id=?',JSON.stringify({...JSON.parse(normal.asset),...patch}),target);const held=await both({input:contextInput});assert.equal(held.result.reason,reason);assert.equal(held.quote,null);}
 await write('UPDATE collect_assets SET asset=? WHERE id=?','x'.repeat(16385),target);assert.equal((await both({input:contextInput})).result.reason,'asset-byte-bound');
 await write('UPDATE collect_assets SET asset=? WHERE id=?',normal.asset.replace('"version":0','"version":9,"version":0'),target);assert.equal((await both({input:contextInput})).result.reason,'invalid-asset-json');
 await write('UPDATE collect_assets SET asset=? WHERE id=?',normal.asset,target);await write('UPDATE collect_inventories SET state=? WHERE id=?','synthetic-state-not-selected-'+('x'.repeat(1000000)),f.inventoryId);assert.equal((await both({input:contextInput})).result.kind,'ready');
 for(const table of ['collect_operations','tx_intents','tx_attempts']){assert.equal(node.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(await edge.db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),0);}
 assert.ok(maxBytes<65536);t.diagnostic(JSON.stringify({pairedReads:requests,statementsPerRead:3,batchesPerRead:1,maxResultBytes:maxBytes,activeQuoteAuthority:false,financialExecution:false}));
});
