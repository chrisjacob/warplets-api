import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {quoteProvenanceFixture} from '../../application/fixtures/quote-provenance.mjs';
import {QUOTE_TEST_PRINCIPAL} from '../../quotes/guarded-test-harness.mjs';
import {economicPlanFixture,economicPlanRequest} from '../../storage/economic-plans.fixtures.mjs';
const at=Date.UTC(2026,10,5,12);
test('actual D1 economic persistence enforces both children, immutable identity, replay and claim fences',async t=>{
 const node=await economicPlanFixture(t),edge=await localRuntime(t,new URL('./fixtures/economic-plan-worker.ts',import.meta.url)),f=await quoteProvenanceFixture({crypto:node.crypto,now:at,marketId:'persist-swap'});
 for(const table of ['market_fixtures','vault_manifests'])for(const row of node.db.prepare('SELECT * FROM '+table).all()){const keys=Object.keys(row);await edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
 await edge.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(QUOTE_TEST_PRINCIPAL.id,'evidence-ingest').run();
 const {byteDigest,...entry}=await f.reader.read('good'),fixture={source:f.source,records:[{...entry,bytes:[...entry.bytes]}]},log=[];
 const call=async request=>{const r=await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({fixture,request:{nowMs:at+20,...request}})});assert.equal(r.status,200);const value=await r.json();if(value.metrics)log.push(value.metrics);return value;};
 for(const request of [{method:'register'},{method:'bind',input:f.bind},{method:'ingest',input:f.request()},{method:'materialize'}]){const r=await call({...request,marketId:f.marketId,nowMs:at});assert.equal(r.result.kind,'committed',JSON.stringify(r));}
 const counts=async()=>({...await edge.db.prepare("SELECT (SELECT count(*) FROM app_economic_intents) intents,(SELECT count(*) FROM app_economic_preparations) preparations,(SELECT count(*) FROM app_command_receipts WHERE operation_kind='transactions.prepare-economic-plan.v1') receipts").first()});
 for(const fault of ['omit-intent','omit-preparation']){const r=await call({method:'persist',input:economicPlanRequest(),fault});assert.ok(r.error,JSON.stringify(r));assert.equal(r.faultInjected,1);assert.deepEqual(await counts(),{intents:0,preparations:0,receipts:0});}
 const input=economicPlanRequest(),first=await call({method:'persist',input}),original=await node.repo.prepare(input);assert.equal(first.result.kind,'committed');assert.deepEqual(first.result.value,original.value);
 const read={principal:input.principal,intentId:original.value.intentId,preparationId:original.value.preparationId};assert.deepEqual((await call({method:'read-economic',input:read})).result,await node.repo.read(read));
 const duplicate={...input,requestKey:'another-key'};const linked=await call({method:'persist',input:duplicate});assert.equal(linked.result.kind,'committed');assert.deepEqual(linked.result.value,original.value);assert.deepEqual(await counts(),{intents:1,preparations:1,receipts:2});
 const changed=structuredClone(input);changed.request.maximumFeeUnits='20000';assert.equal((await call({method:'persist',input:changed})).result.code,'idempotency_conflict');changed.requestKey='changed-fee';assert.equal((await call({method:'persist',input:changed})).result.kind,'committed');changed.request.parameters.inputUnits='2000000';changed.requestKey='changed-economics';assert.equal((await call({method:'persist',input:changed})).result.code,'economic_intent_conflict');
 const race={...input,intentKey:'concurrent',requestKey:'concurrent'};const racers=await Promise.all([call({method:'persist',input:race}),call({method:'persist',input:race})]);assert.deepEqual(racers.map(r=>r.result.kind).sort(),['committed','replayed']);
 const lost=await call({method:'persist',input:{...input,intentKey:'lost',requestKey:'lost'},fault:'lose'});assert.equal(lost.result.kind,'replayed');assert.equal(lost.faultInjected,1);
 for(const fault of ['clock','source','generation']){const before=await counts(),r=await call({method:'persist',input:{...input,intentKey:fault,requestKey:fault},fault});assert.equal(r.result.kind,'conflict',JSON.stringify(r));assert.equal(r.faultInjected,1);assert.deepEqual(await counts(),before);}
 const old=await call({method:'persist',input,nowMs:at+60000});assert.equal(old.result.kind,'replayed');assert.deepEqual(old.result.value,original.value);assert.equal((await call({method:'read-economic',input:read,nowMs:at+60000})).result.value.expired,true);
 assert.equal(await edge.db.prepare('SELECT count(*) n FROM tx_intents').first('n'),0);assert.equal(await edge.db.prepare('SELECT count(*) n FROM tx_attempts').first('n'),0);
 const maxima={calls:log.length,sqlStatements:Math.max(...log.map(x=>x.sqlStatements)),batchBytes:Math.max(...log.map(x=>x.maxBatchBytes)),parameters:Math.max(...log.map(x=>x.maxParameters)),objectReads:Math.max(...log.map(x=>x.objectReads))};assert.ok(maxima.sqlStatements<=16);assert.ok(maxima.batchBytes<=262144);assert.ok(maxima.parameters<=100);t.diagnostic(JSON.stringify(maxima));
});
