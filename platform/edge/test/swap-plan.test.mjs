import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {memoryArtifacts} from '../../recovery/fixtures.mjs';
import {quoteProvenanceFixture} from '../../application/fixtures/quote-provenance.mjs';
import {quoteTestDispatch,QUOTE_TEST_PRINCIPAL} from '../../quotes/guarded-test-harness.mjs';
import {createQuoteRepository} from '../../quotes/repository.mjs';
import {createQuoteService} from '../../quotes/service.mjs';
import {createSwapPlanService} from '../../transactions/swap-plan-service.mjs';
const crypto=createNodeCrypto(),now=Date.UTC(2026,10,5,12),principal={kind:'wallet',wallet:'11111111111111111111111111111111'};
test('actual local Node/D1 economic swap plans preserve exact quote bindings and final asynchronous fences',async t=>{
 const db=openDatabase();t.after(()=>db.close());const edge=await localRuntime(t,new URL('./fixtures/swap-plan-worker.ts',import.meta.url)),bucket=await edge.mf.getR2Bucket('MANIFESTS'),store=memoryArtifacts(),f=await quoteProvenanceFixture({crypto,now,marketId:'swap-parity'});f.seed(db);
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(QUOTE_TEST_PRINCIPAL.id,'evidence-ingest');
 for(const table of ['market_fixtures','vault_manifests','app_operator_scopes'])for(const row of db.prepare('SELECT * FROM '+table).all()){
  const keys=Object.keys(row);await edge.db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
 }
 const {byteDigest,...entry}=await f.reader.read('good'),fixture={source:f.source,records:[{...entry,bytes:[...entry.bytes]}]},driver=createNodeAtomicDriver(db);
 const call=async request=>{const r=await edge.mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({fixture,request})});assert.equal(r.status,200);return r.json();};
 for(const request of [{method:'register'},{method:'bind',input:f.bind},{method:'ingest',input:f.request()},{method:'materialize'}]){
  Object.assign(request,{marketId:f.marketId,nowMs:now+20});const a=await quoteTestDispatch({driver,store,crypto,ids:{next:randomUUID},fixture,request}),b=await call(request);assert.equal(a.result.kind,'committed',JSON.stringify(a));assert.equal(b.result.kind,'committed',JSON.stringify(b));
 }
 const repository=createQuoteRepository(driver,{crypto,ids:{next:randomUUID}}),clock={nowMs:()=>now+20},quotes=createQuoteService({repository,store,crypto,clock}),service=createSwapPlanService({quoteRepository:repository,quoteService:quotes,crypto,clock});
 const input={principal,request:{format:'10x.action-request.v1',action:'swap',parameters:{marketId:f.marketId,direction:'buy-att',inputUnits:'1000000',slippageBps:50},maximumFeeUnits:'10000'}};
 const snapshot=async()=>({receipts:await edge.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').first('n'),quotes:await edge.db.prepare('SELECT COUNT(*) n FROM app_quote_inputs').first('n'),intents:await edge.db.prepare('SELECT COUNT(*) n FROM tx_intents').first('n')});
 const before=await snapshot();let count=0,maxSql=0,maxReads=0,maxBytes=0;
 async function pair(expected){const a=await service.prepare(input),b=await call({method:'prepare',nowMs:now+20,input});assert.deepEqual(b.result,a);assert.equal(a.kind,expected);count++;maxSql=Math.max(maxSql,b.metrics.sqlStatements);maxReads=Math.max(maxReads,b.metrics.objectReads);maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(b.result)));assert.equal(b.metrics.objectWrites,0);return a;}
 const buy=await pair('prepared-economic-plan');assert.equal(buy.bindings.receiptDigest,buy.quote.evidence.receiptDigest);assert.equal(buy.wire,null);
 input.request.parameters.direction='sell-att';input.request.parameters.inputUnits='1000000000000';await pair('prepared-economic-plan');
 const identity=JSON.parse(db.prepare('SELECT envelope_json FROM app_evidence_receipts').get().envelope_json),saved=store.objects.get(identity.objectRef);store.objects.delete(identity.objectRef);await bucket.delete(identity.objectRef);assert.equal((await pair('pending')).reason,'evidence_unavailable');store.objects.set(identity.objectRef,saved);await bucket.put(identity.objectRef,saved,{sha256:identity.byteDigest,httpMetadata:{contentType:'application/json'}});
 for(const [fault,reason,fired]of [['expire','quote_expired',1],['change-context','quote_evidence_changed',2]]){const result=await call({method:'prepare',nowMs:now+20,input,fault});assert.equal(result.result.reason,reason);assert.equal(result.faultInjected,fired);assert.ok(result.metrics.sqlStatements<=10);count++;}
 assert.deepEqual(await snapshot(),before);assert.ok(maxSql<=5);assert.ok(maxReads<=1);assert.ok(maxBytes<=16384);t.diagnostic(JSON.stringify({calls:count,maxSql,maxReads,maxBytes,financialExecution:false}));
});
