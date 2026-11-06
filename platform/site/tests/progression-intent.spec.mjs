import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
function memory(){const entries=new Map();return {get length(){return entries.size;},getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key),key:n=>[...entries.keys()][n]??null};}
async function module(t){const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());return vite.ssrLoadModule('/src/progression-intent.ts');}
const expires=Date.parse('2026-11-06T01:02:00.000Z'),quote={asOf:'2026-11-06T01:00:00.000Z',source:'local-fixture',inventoryId:'synthetic-season',quoteId:'synthetic-quote',bindingDigest:'a'.repeat(64),policyVersion:'collection-progression-v1',targetVersion:3,materialVersion:4,maxTotalLamports:'10000000',quoteExpiresMs:expires,expiresAt:new Date(expires).toISOString(),costStatus:'local-preview-only',ceilingScope:'disclosed-local-components-only',networkCost:'unknown',totalCost:'unknown',executable:false,kind:'upgrade',feeLamports:'10000000',materialId:'synthetic-material',targetId:'synthetic-target',nextTargetLevel:2,nextTargetExpiry:'2026-12-01T00:00:00.000Z',materialProbabilities:[{level:1,count:1000,total:1000,expiresAt:'2026-11-01T00:00:00.000Z',remainingMs:0}]};
const target={id:quote.targetId,inventoryId:quote.inventoryId,owner:'owner-a',revealStatus:'revealed',version:3,level:1},material={...target,id:quote.materialId,version:4};
test('progression request captures all reviewed bindings and retains exact unknown body/key beyond quote expiry',async t=>{
 const {progressionJournal,reviewedProgressionBody}=await module(t),storage=memory();let keys=0;const journal=progressionJournal(storage,'owner-a',()=>String(++keys));
 const q=structuredClone(quote),selection={target:structuredClone(target),material:structuredClone(material)},attempt=journal.capture(q,selection),body=reviewedProgressionBody(quote);
 assert.deepEqual(attempt.body,body);assert.equal(body.quoteExpiresMs,expires);assert.equal(body.reviewedFeeLamports,'10000000');assert.equal(body.reviewedMaxTotalLamports,'10000000');assert.equal(body.bindingDigest,quote.bindingDigest);assert.equal(body.expectedMaterialVersion,4);
 q.feeLamports='999';selection.target.owner='another';assert.equal(attempt.quote.feeLamports,'10000000');assert.equal(attempt.selection.target.owner,'owner-a');assert.ok(Object.isFrozen(attempt.body));
 const retry=journal.read(quote.inventoryId,quote.targetId,quote.materialId);assert.equal(retry.kind,'pending');assert.deepEqual(retry.attempt.body,body);assert.equal(retry.attempt.key,attempt.key);assert.equal(keys,1);
 assert.equal(journal.capture(quote,{target,material}).key,attempt.key);assert.equal(keys,1);assert.throws(()=>journal.capture({...quote,quoteId:'replacement'},{target,material}),/Resolve the retained request/);
 journal.complete({...attempt,key:'wrong'});assert.equal(journal.list().length,1);journal.complete(attempt);assert.equal(journal.list().length,0);
});
test('journal is owner scoped and holds corrupted or substituted stored terms without deleting unknown work',async t=>{
 const {progressionJournal}=await module(t),storage=memory(),a=progressionJournal(storage,'owner-a',()=> 'stable'),b=progressionJournal(storage,'owner-b',()=> 'other');a.capture(quote,{target,material});assert.equal(b.list().length,0);assert.equal(b.read(quote.inventoryId,quote.targetId,quote.materialId),null);
 const name=storage.key(0),raw=JSON.parse(storage.getItem(name));raw.body.reviewedMaxTotalLamports='20000000';storage.setItem(name,JSON.stringify(raw));assert.equal(a.list()[0].kind,'invalid');assert.throws(()=>a.capture(quote,{target,material}),/Resolve the retained request/);assert.equal(storage.length,1);
 raw.body.reviewedMaxTotalLamports='10000000';raw.wallet='owner-b';storage.setItem(name,JSON.stringify(raw));assert.equal(a.list()[0].kind,'invalid');
});
test('visual requests omit material identity, bad ceilings/times/owners are rejected and storage failure prevents a sendable capture',async t=>{
 const {progressionJournal,reviewedProgressionBody}=await module(t),visual={...quote,kind:'visual',materialId:null,materialVersion:null};const body=reviewedProgressionBody(visual);assert.equal(Object.hasOwn(body,'materialId'),false);assert.equal(Object.hasOwn(body,'expectedMaterialVersion'),false);
 assert.throws(()=>reviewedProgressionBody({...quote,maxTotalLamports:'1'}),/inconsistent/);assert.throws(()=>reviewedProgressionBody({...quote,quoteExpiresMs:expires+1}),/inconsistent/);
 const storage=memory(),journal=progressionJournal(storage,'owner-a',()=> 'test');assert.throws(()=>journal.capture(quote,{target:{...target,owner:'wrong'},material}),/no longer matches/);assert.equal(storage.length,0);
 assert.throws(()=>progressionJournal({...storage,setItem(){throw Error('Synthetic storage quota.');}},'owner-a',()=> 'test').capture(quote,{target,material}),/storage quota/);
});
test('a same-asset response must match every reviewed quote and operation term before it can clear an unknown request',async t=>{
 const {progressionJournal,matchesProgressionReceipt}=await module(t),journal=progressionJournal(memory(),'owner-a',()=> 'same-key'),attempt=journal.capture(quote,{target,material});
 const receipt={id:'operation',kind:'upgrade',inventoryId:quote.inventoryId,owner:'owner-a',status:'awaiting-evidence',createdAt:quote.asOf,stageId:null,targetId:target.id,materialId:material.id,assetId:null,priceLamports:null,costLamports:null,feeLamports:quote.feeLamports,quoteId:quote.quoteId,bindingDigest:quote.bindingDigest};
 assert.equal(matchesProgressionReceipt(attempt,receipt),true);
 for(const change of [{quoteId:'another-quote'},{bindingDigest:'b'.repeat(64)},{kind:'visual'},{feeLamports:'20000000'},{owner:'owner-b'},{inventoryId:'another'},{targetId:material.id},{materialId:null}])assert.equal(matchesProgressionReceipt(attempt,{...receipt,...change}),false);
 assert.equal(matchesProgressionReceipt(attempt,{...receipt,quoteId:undefined,bindingDigest:undefined}),false);assert.equal(journal.list().length,1);
});
