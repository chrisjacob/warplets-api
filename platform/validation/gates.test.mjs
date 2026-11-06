import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createGateIndex} from './gates.mjs';
const crypto=createNodeCrypto();
const row=(id,status='fixture-proven')=>({id,requirementId:'custody.principal',status,evidenceKind:'recorded-fixture',source:{commit:'a'.repeat(40),digest:'b'.repeat(64),path:'platform/lab/fixtures/recorded.json'},program:'unselected candidate',configuration:null,network:null,slot:null,observedAtMs:null,applicability:['disposable recorded configuration only'],limitations:['No production authority or current provider claim'],reviewOwner:null,acceptedScope:null});
test('named scoped acceptance cannot erase an incompatible record or enable execution',async()=>{
 const incompatible=row('failed-admin','incompatible'),accepted={...row('review','accepted-for-named-scope'),reviewOwner:'fixture reviewer',acceptedScope:'local diagnostic only'},missing={...row('precision','missing'),requirementId:'farm.precision',evidenceKind:'missing',source:null};
 const index=await createGateIndex([accepted,missing,incompatible],{crypto});assert.equal(index.requirements[0].hasIncompatibility,true);assert.equal(index.requirements[0].reviewAuthority,'unverified');assert.equal(index.requirements[1].hasMissingEvidence,true);assert.equal(index.financialExecution,false);assert.equal(index.releaseAuthorized,false);assert.equal(index.isAuthorization,false);assert.ok(Object.isFrozen(index.records[0].source));assert.deepEqual(await createGateIndex([incompatible,accepted,missing],{crypto}),index);
});
test('captures inputs before hashing and rejects malformed identity, scope, accessors and bounds',async()=>{
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),r=row('one');const pending=createGateIndex([r],{crypto:{async sha256(bytes){entered();await gate;return crypto.sha256(bytes);}}});await started;r.status='incompatible';release();assert.equal((await pending).records[0].status,'fixture-proven');
 for(const bad of [{...row('one'),extra:true},{...row('one'),source:null},{...row('one'),status:'accepted-for-named-scope'},{...row('one'),source:{...row('one').source,path:'../outside'}},{...row('one'),limitations:[]}])await assert.rejects(createGateIndex([bad],{crypto}));
 await assert.rejects(createGateIndex([row('same'),row('same')],{crypto}));await assert.rejects(createGateIndex(Array.from({length:33},(_,i)=>row(String(i))),{crypto}));
 let calls=0;const getter=row('getter');Object.defineProperty(getter,'source',{enumerable:true,get(){calls++;return null;}});await assert.rejects(createGateIndex([getter],{crypto}));assert.equal(calls,0);
});
