import test from 'node:test';
import assert from 'node:assert/strict';
import {localRuntime} from './local-runtime.mjs';
import {quoteProvenanceFixture} from '../../application/fixtures/quote-provenance.mjs';
import {QUOTE_TEST_PRINCIPAL} from '../../quotes/guarded-test-harness.mjs';
import {economicPlanRequest} from '../../storage/economic-plans.fixtures.mjs';
import {costReadinessFixture} from '../../costs/readiness.fixtures.mjs';
import {recordUsage} from '../../operations/controls.mjs';
const at=Date.UTC(2026,10,5,12);
test('actual D1 source-bound cost readiness matches Node, stays readonly and fences source/clock/generation',async t=>{
 const node=await costReadinessFixture(t),edge=await localRuntime(t,new URL('./fixtures/cost-readiness-worker.ts',import.meta.url)),f=await quoteProvenanceFixture({crypto:node.crypto,now:at,marketId:'persist-swap'});
 for(const table of ['market_fixtures','vault_manifests'])for(const row of node.db.prepare('SELECT * FROM '+table).all()){const keys=Object.keys(row);await edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
 await edge.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').bind(QUOTE_TEST_PRINCIPAL.id,'evidence-ingest').run();
 const {byteDigest,...entry}=await f.reader.read('good'),fixture={source:f.source,records:[{...entry,bytes:[...entry.bytes]}]},log=[];
 const call=async request=>{const r=await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({fixture,request:{nowMs:node.clock.nowMs(),...request}})});assert.equal(r.status,200);const result=await r.json();assert.equal(result.error,undefined,JSON.stringify(result));if(request.method==='readiness')log.push(result.metrics);return result;};
 for(const request of [{method:'register'},{method:'bind',input:f.bind},{method:'ingest',input:f.request()},{method:'materialize'}])assert.equal((await call({...request,marketId:f.marketId,nowMs:at})).result.kind,'committed');
 const accepted=await call({method:'persist',input:economicPlanRequest()});assert.equal(accepted.result.kind,'committed');assert.equal(accepted.result.value.preparationId,node.query.preparationId);
 const read=extra=>call({method:'readiness',query:node.query,planning:node.planning,...extra});
 const snapshot=async()=>await edge.db.prepare('SELECT (SELECT revision FROM app_recovery_watermark WHERE id=1) watermark,(SELECT count(*) FROM app_command_receipts) receipts,(SELECT count(*) FROM tx_attempts) attempts').first();
 const before=await snapshot(),first=await read();assert.equal(first.result.kind,'report');assert.deepEqual(first.result,await node.service.read(node.query,node.planning));assert.deepEqual(await snapshot(),before);assert.equal(first.result.value.financialExecution,false);assert.equal(first.result.value.executionContext.missing.includes('fundingStateHash'),true);assert.equal(first.result.value.selectedActionCosts.companyCollectibleUnits,null);
 assert.equal((await read({query:{...node.query,principal:{kind:'wallet',wallet:'So11111111111111111111111111111111111111112'}}})).result.kind,'missing');
 // Record actual local usage in Node; replay these explicit fixture rows in D1,
 // preserving the actual reader and all ordinary watermark triggers.
 recordUsage(node.db,{provider:'private-provider',metric:'new-monthly-usd',measured:'5000000',atMs:node.clock.nowMs(),evidenceRef:'private-source'});
 for(const row of node.db.prepare('SELECT * FROM ops_usage').all()){const keys=Object.keys(row);await edge.db.prepare('INSERT INTO ops_usage ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();}
 const budget=await read({planning:{}});assert.deepEqual(budget.result,await node.service.read(node.query,{}));assert.equal(budget.result.value.usage.budget.level,'limit');assert.ok(budget.result.value.usage.protectedRecovery.every(v=>v.allowed));assert.doesNotMatch(JSON.stringify(budget),/private-provider|private-source/);
 for(const fault of ['clock','source','generation']){const result=await read({fault});assert.equal(result.faultInjected,1);assert.equal(result.result.kind,'pending',fault);}
 // Match deliberate fixture mutations for a stable changed-source/expired view.
 node.db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.readinessRace',1) WHERE id='persist-swap'").run();node.db.prepare("UPDATE app_recovery_state SET generation='readiness-race' WHERE id=1").run();
 for(const db of [node.db])db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.poolAddress','11111111111111111111111111111111') WHERE id='persist-swap'").run();await edge.db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.poolAddress','11111111111111111111111111111111') WHERE id='persist-swap'").run();
 let result=await read({planning:{}});assert.equal(result.result.value.source.status,'changed');assert.deepEqual(result.result,await node.service.read(node.query,{}));node.setNow(at+60000);result=await read({planning:{}});assert.deepEqual(result.result,await node.service.read(node.query,{}));assert.equal(result.result.value.preparation.status,'expired');
 await edge.db.prepare("UPDATE app_recovery_state SET status='held' WHERE id=1").run();assert.equal((await read({planning:{}})).result.kind,'pending');
 const maxima={calls:log.length,sqlStatements:Math.max(...log.map(m=>m.sqlStatements)),batchBytes:Math.max(...log.map(m=>m.maxBatchBytes)),resultBytes:Math.max(...log.map(m=>m.maxResultBytes)),reportBytes:Math.max(...log.map(m=>m.reportBytes))};assert.ok(maxima.sqlStatements<=32);assert.ok(maxima.batchBytes<=262144);assert.ok(maxima.reportBytes<=196608);assert.ok(maxima.resultBytes<=65536);t.diagnostic(JSON.stringify(maxima));
});
