import test from 'node:test';
import assert from 'node:assert/strict';
import {legacyAdmissionFixture,legacyAdmissionWallet} from '../../collect/legacy-admission-audit.fixtures.mjs';
import {auditLegacyAdmission,startLegacyAdmissions,finishLegacyAdmissions} from '../../collect/legacy-admission-audit.mjs';
import {localRuntime} from './local-runtime.mjs';
const record=r=>({id:r.id,size:r.size,base64:Buffer.from(r.bytes).toString('base64')}),wire=input=>({...input,sourceRoot:record(input.sourceRoot),admissionPage:record(input.admissionPage),membership:input.membership?{seal:input.membership.seal,page:record(input.membership.page)}:null});
test('actual Node/workerd/D1 original-operation reads preserve pending/settled economic audit and failure parity',async t=>{
 const f=legacyAdmissionFixture(t);f.publish(f.stage('first'));const first=f.admit('first');f.settle(first.operation.id);f.admit('first');f.admit('first',legacyAdmissionWallet(2));const s=await f.snapshot(),{mf}=await localRuntime(t,new URL('./fixtures/legacy-admission-audit-worker.ts',import.meta.url)),db=await mf.getD1Database('DB');
 // Exact original legacy rows, no normalized045/046 admission/fulfillment receipt.
 for(const table of ['collect_inventories','collect_operations'])for(const row of f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()){const keys=Object.keys(row);await db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...keys.map(k=>row[k])).run();}
 const call=async body=>{const r=await mf.dispatchFetch('http://localhost/__fixture',{method:'POST',body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 let prefix=await startLegacyAdmissions(s.bundle.root,{crypto:f.crypto});assert.deepEqual((await call({method:'start',record:record(s.bundle.root)})).result,prefix);const samples=[];let maxWorking=0;
 for(let n=0;n<3;n++){const input=await s.input(n,prefix),node=await auditLegacyAdmission(input,{crypto:f.crypto}),edge=await call({method:'audit',input:wire(input)});assert.equal(edge.status,200,JSON.stringify(edge));assert.deepEqual(edge.result,node);assert.equal(edge.sqlStatements,1);maxWorking=Math.max(maxWorking,edge.metrics.workingBytes);samples.push(input);prefix=node.nextPrefix;}
 const done=await finishLegacyAdmissions(s.bundle.root,prefix,{crypto:f.crypto});assert.deepEqual((await call({method:'finish',record:record(s.bundle.root),prefix})).result,done);assert.deepEqual(done.counts,{paid:1,free:0,founder:0,pending:2,unsold:997,unmintedReserve:999});
 for(const field of ['stageAudit','controlFact','priorFacts','mintAudit']){const input=structuredClone(samples[0]);input[field]=null;const node=await auditLegacyAdmission(input,{crypto:f.crypto}),edge=await call({method:'audit',input:wire(input)});assert.equal(edge.status,200);assert.deepEqual(edge.result,node);assert.equal(node.kind,'held');}
 const duplicate=structuredClone(samples[1]);duplicate.priorFacts.ownerRequestCount=1;await assert.rejects(auditLegacyAdmission(duplicate,{crypto:f.crypto}),e=>e.code==='legacy-admission-duplicate-or-unbound-index');assert.equal((await call({method:'audit',input:wire(duplicate)})).code,'legacy-admission-duplicate-or-unbound-index');
 await db.prepare('UPDATE collect_operations SET receipt=? WHERE id=?').bind('{}',samples[1].operation.id).run();assert.equal((await call({method:'audit',input:wire(samples[1])})).code,'legacy-admission-pending-outcome');
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM app_collection_mint_fulfillments').first()).n,0);assert.equal((await mf.dispatchFetch('http://localhost/api/v1/legacy-admission-audit')).status,404);
 t.diagnostic(JSON.stringify({originalLegacyOperations:3,settled:1,pending:2,maxSqlStatementsPerAudit:1,maxWorkingBytes:maxWorking,fixtureHistoricalPrerequisites:true,normalizedReceiptsFabricated:0,applicationActivation:false}));
});
