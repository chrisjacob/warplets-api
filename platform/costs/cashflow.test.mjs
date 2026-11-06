import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCashflow,CASHFLOW_FORMAT,CASHFLOW_LIMITS} from './cashflow.mjs';
const op=(id,dependsOn=[])=>({id,dependsOn});
const fee=(id,operationId,unitAmount='5',more={})=>({id,operationId,sharedAccount:null,payer:'claimant',unit:'lamport',kind:'consumed',count:1,unitAmount,expectedRefundableUnitAmount:'0',closure:null,...more});
const rent=(id,operationId,close=operationId,more={})=>fee(id,operationId,'100',{kind:'rent',expectedRefundableUnitAmount:'100',closure:close===null?null:{operationId:close,status:'established'},...more});
const graph=(operations,charges,interruption=null)=>({format:CASHFLOW_FORMAT,operations,charges,interruption});
const one=g=>evaluateCashflow(g).totals[0];

test('shared setup is charged once with exact identity and rejects conflicting economics or setup placement',()=>{
 const operations=[op('setup'),op('claim',['setup'])],a=rent('ata','setup',null,{sharedAccount:'actual-account',expectedRefundableUnitAmount:'0'}),b={...a,id:'same-ata'},result=evaluateCashflow(graph(operations,[a,b,fee('network','claim')]));
 assert.equal(result.distinctChargeCount,2);assert.deepEqual(result.deduplicated,[{id:'same-ata',chargedAs:'ata'}]);assert.equal(result.totals[0].grossUpfront,'105');assert.equal(result.totals[0].peakUpfront,'105');assert.equal(result.totals[0].consumed,'105');
 for(const patch of [{unitAmount:'101'},{payer:'founder'},{unit:'ogRaw'},{operationId:'claim'},{count:0},{expectedRefundableUnitAmount:'1'}])assert.throws(()=>evaluateCashflow(graph(operations,[a,{...b,...patch}])),/shared|closure/);
 const existing={...a,count:0,unitAmount:null};assert.equal(one(graph(operations,[existing])).grossUpfront,'0');
});
test('sequential established closure reduces peak; concurrency requires full temporary rent funding before refunds',()=>{
 const charges=[rent('r1','a'),fee('f1','a'),rent('r2','b'),fee('f2','b')];
 const sequential=one(graph([op('a'),op('b',['a'])],charges)),concurrent=one(graph([op('a'),op('b')],charges));
 assert.deepEqual([sequential.grossUpfront,sequential.peakUpfront,sequential.consumed,sequential.expectedRefundable],['210','110','10','200']);assert.equal(concurrent.peakUpfront,'210');
 // Even a closure in the same operation never erases its own upfront funding.
 assert.equal(one(graph([op('a')],[rent('r','a')])).peakUpfront,'100');
});
test('peak considers every admissible prefix instead of selecting one cheap order or wave',()=>{
 const g=graph([op('prepare'),op('close',['prepare']),op('independent'),op('after',['independent'])],[rent('temporary','prepare','close'),fee('fee','independent','7'),rent('later','after','after')]);
 // Hold prepare open, complete independent, start later: both rents plus fee.
 assert.equal(one(g).peakUpfront,'207');assert.equal(one(g).consumed,'7');
 const ordered=structuredClone(g);ordered.operations[3].dependsOn.push('close');assert.equal(one(ordered).peakUpfront,'107');
});
test('interruption retains open float and separately unquoted cleanup liability, completed closure releases it',()=>{
 const operations=[op('prepare'),op('payout',['prepare'])],charges=[rent('temp','prepare','payout',{expectedRefundableUnitAmount:'90'}),fee('fee','payout','3')];
 const interrupted=one(graph(operations,charges,{completedOperationIds:['prepare'],startedOperationIds:[]})).interruption;
 assert.deepEqual(interrupted,{incurredUpfront:'100',incurredKnownSubtotal:'100',consumed:'10',heldFloat:'90',heldFloatKnownSubtotal:'90',cleanup:{openAccountCount:'1',additionalCost:null,status:'unquoted'}});
 const during=one(graph(operations,charges,{completedOperationIds:['prepare'],startedOperationIds:['payout']})).interruption;assert.equal(during.heldFloat,'90');assert.equal(during.consumed,'13');
 const after=one(graph(operations,charges,{completedOperationIds:['prepare','payout'],startedOperationIds:[]})).interruption;assert.equal(after.heldFloat,'0');assert.equal(after.cleanup.additionalCost,'0');
});
test('unknown amounts/counts/closure remain unknown while known subtotals and explicit zero counts stay distinct',()=>{
 const operations=[op('a')],unknown=one(graph(operations,[rent('unknown','a',null,{count:null,unitAmount:'0',expectedRefundableUnitAmount:null}),fee('known','a','7')]));assert.equal(unknown.grossUpfront,null);assert.equal(unknown.grossKnownSubtotal,'7');assert.equal(unknown.peakUpfront,null);assert.equal(unknown.consumed,null);
 const zero=one(graph(operations,[rent('zero','a',null,{count:0,unitAmount:null,expectedRefundableUnitAmount:null})]));assert.deepEqual([zero.grossUpfront,zero.peakUpfront,zero.consumed,zero.expectedRefundable],['0','0','0','0']);
 const missingClosure=one(graph(operations,[rent('r','a','a',{closure:{operationId:'a',status:'unknown'}})],{completedOperationIds:['a'],startedOperationIds:[]}));assert.equal(missingClosure.peakUpfront,null);assert.equal(missingClosure.peakUpfrontUpperBound,'100');assert.equal(missingClosure.expectedRefundable,null);assert.equal(missingClosure.interruption.heldFloat,null);assert.equal(missingClosure.interruption.cleanup.openAccountCount,'1');
 assert.equal(one(graph(operations,[fee('missing','a',null)])).consumed,null);
});
test('payer and denomination never offset each other and arithmetic preserves large base units',()=>{
 const charges=[rent('r','a'),fee('founder','a','12',{payer:'founder'}),fee('usd','a','31',{unit:'microUSD'}),fee('og','a','9'.repeat(80),{unit:'ogRaw',count:10000})],result=evaluateCashflow(graph([op('a')],charges));assert.equal(result.totals.length,4);assert.equal(result.totals.find(r=>r.payer==='founder').peakUpfront,'12');assert.equal(result.totals.find(r=>r.unit==='ogRaw').grossUpfront,String(BigInt('9'.repeat(80))*10000n));assert.equal(result.financialExecution,false);assert.equal(result.isAuthorization,false);assert.equal(result.assumptions,'caller-supplied-unverified');assert.ok(Object.isFrozen(result.totals[0]));
});
test('strict DAG/closed-shape/interruption/amount bounds reject contradictory graphs without invoking accessors',()=>{
 const valid=graph([op('a'),op('b',['a'])],[rent('r','a','b')]);
 for(const mutate of [x=>x.operations[0].dependsOn.push('b'),x=>x.operations[0].dependsOn.push('a'),x=>x.operations.push(op('a')),x=>x.operations[1].dependsOn.push('a'),x=>x.operations[1].dependsOn=['absent'],x=>x.charges.push({...x.charges[0]}),x=>x.charges[0].unitAmount='01',x=>x.charges[0].unitAmount=-1,x=>x.charges[0].count=10001,x=>x.charges[0].expectedRefundableUnitAmount='101',x=>x.charges[0].closure.operationId='absent',x=>{x.charges[0].operationId='b';x.charges[0].closure.operationId='a';},x=>x.signature='fake',x=>x.interruption={completedOperationIds:['b'],startedOperationIds:[]},x=>x.interruption={completedOperationIds:['a'],startedOperationIds:['a']},x=>x.interruption={completedOperationIds:['a','a'],startedOperationIds:[]},x=>x.interruption={completedOperationIds:[],startedOperationIds:['b']}]){const copy=structuredClone(valid);mutate(copy);assert.throws(()=>evaluateCashflow(copy));}
 let invoked=false;const accessor={...valid};Object.defineProperty(accessor,'operations',{enumerable:true,get(){invoked=true;return [];}});assert.throws(()=>evaluateCashflow(accessor));assert.equal(invoked,false);
 const nested=graph([op('a')],[]);Object.defineProperty(nested.operations,'0',{enumerable:true,get(){invoked=true;return op('a');}});assert.throws(()=>evaluateCashflow(nested));assert.equal(invoked,false);
 const largeOps=Array.from({length:16},(_,i)=>op(('op'+i).padEnd(128,'x'),Array.from({length:i},(_,j)=>('op'+j).padEnd(128,'x')))),largeCharges=Array.from({length:64},(_,i)=>rent(('term'+i).padEnd(128,'x'),largeOps[0].id,largeOps[15].id,{sharedAccount:('account'+i).padEnd(128,'x'),payer:'p'.repeat(128),unitAmount:'9'.repeat(80),expectedRefundableUnitAmount:'9'.repeat(80)}));assert.throws(()=>evaluateCashflow(graph(largeOps,largeCharges)),/byte bound/);
 assert.deepEqual(evaluateCashflow(graph([],[])).totals,[]);assert.throws(()=>evaluateCashflow(graph(Array.from({length:17},(_,i)=>op('o'+i)),[])));assert.throws(()=>evaluateCashflow(graph([op('a')],Array.from({length:65},(_,i)=>fee('f'+i,'a')))));
});
test('maximum bounded16-operation64-charge graph is evaluated without schedule enumeration growth beyond65536 prefixes',()=>{
 const operations=Array.from({length:CASHFLOW_LIMITS.operations},(_,i)=>op('op'+i)),charges=Array.from({length:CASHFLOW_LIMITS.charges},(_,i)=>rent('r'+i,'op'+(i%16)));const input=graph(operations,charges),before=JSON.stringify(input),result=evaluateCashflow(input);assert.equal(result.evaluatedPrefixes,65536);assert.equal(result.totals[0].peakUpfront,'6400');assert.equal(result.totals[0].expectedRefundable,'6400');assert.equal(result.totals[0].consumed,'0');assert.equal(JSON.stringify(input),before);
});
