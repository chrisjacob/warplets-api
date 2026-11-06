import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
function memory(){const entries=new Map();return {get length(){return entries.size;},getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key),key:n=>[...entries.keys()][n]??null};}
async function module(t){const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());return vite.ssrLoadModule('/src/mint-intent.ts');}
const now=Date.parse('2026-11-06T01:00:00.000Z'),stage={id:'synthetic-paid',type:'public',status:'open',opensAt:new Date(now-1000).toISOString(),closesAt:new Date(now+60000).toISOString(),priceLamports:'10000000',costLamports:'2000000',allocation:2,available:2,walletLimit:1,eligible:true,walletReservations:0,openingHold:null,termsDigest:'a'.repeat(64)};
test('mint retains immutable reviewed digest, key and local costs across expiry and caller mutation',async t=>{
 const {mintJournal,mintReviewAvailable}=await module(t),storage=memory();let keys=0;const journal=mintJournal(storage,'owner-a',()=>String(++keys)),input=structuredClone(stage),attempt=journal.capture('synthetic-season',input,now);
 input.priceLamports='999';input.termsDigest='b'.repeat(64);assert.deepEqual(attempt.body,{expectedTermsDigest:stage.termsDigest});assert.equal(attempt.stage.priceLamports,stage.priceLamports);assert.ok(Object.isFrozen(attempt.stage));
 assert.equal(mintReviewAvailable(stage,now+60000),false);const replay=journal.capture('synthetic-season',{...stage,status:'closed',available:0},now+100000);assert.deepEqual(replay,attempt);assert.equal(keys,1);
 assert.throws(()=>journal.capture('synthetic-season',{...stage,termsDigest:'c'.repeat(64)},now),/Resolve the retained/);journal.complete({...attempt,key:'wrong'});assert.equal(journal.list().length,1);journal.complete(attempt);assert.equal(journal.list().length,0);
});
test('mint captures only complete available reviewed stage terms and storage failure leaves no sendable request',async t=>{
 const {mintJournal,mintReviewAvailable}=await module(t);assert.equal(mintReviewAvailable(stage,now),true);
 for(const change of [{termsDigest:undefined},{termsDigest:'invalid'},{status:'closed'},{available:0},{openingHold:'paused'},{eligible:null},{walletReservations:null},{walletReservations:1},{type:'founder'},{reservationStatus:{status:'unavailable',reason:'admission-unavailable',snapshotId:null,used:0,remaining:1,stageStatus:'open',asOf:new Date(now).toISOString(),source:'local-fixture',executable:false}}]){
  const changed={...stage,...change};assert.equal(mintReviewAvailable(changed,now),false);assert.throws(()=>mintJournal(memory(),'owner-a',()=> 'stable').capture('synthetic-season',changed,now),/Refresh the published/);
 }
 assert.equal(mintReviewAvailable(stage,now-1001),false);
 const storage=memory();assert.throws(()=>mintJournal({...storage,setItem(){throw Error('Synthetic storage quota');}},'owner-a',()=> 'stable').capture('synthetic-season',stage,now),/storage quota/);assert.equal(storage.length,0);
});
test('mint recovery is wallet isolated and holds altered stored body, stage or identity without deletion',async t=>{
 const {mintJournal}=await module(t),storage=memory(),journal=mintJournal(storage,'owner-a',()=> 'stable');journal.capture('synthetic-season',stage,now);
 assert.equal(mintJournal(storage,'owner-b').list().length,0);const name=storage.key(0),original=JSON.parse(storage.getItem(name));
 for(const change of [{wallet:'owner-b'},{inventoryId:'other'},{stageId:'other'},{body:{expectedTermsDigest:'b'.repeat(64)}},{stage:{...stage,termsDigest:'b'.repeat(64)}}]){
  storage.setItem(name,JSON.stringify({...original,...change}));assert.equal(journal.list()[0].kind,'invalid');assert.throws(()=>journal.capture('synthetic-season',stage,now),/Resolve the retained/);assert.equal(storage.length,1);
 }
 storage.setItem(name,'not-json');assert.equal(journal.read('synthetic-season',stage.id).kind,'invalid');
});
test('mint response must match the reviewed identity and all disclosed charges before completing an unknown request',async t=>{
 const {mintJournal,matchesMintReceipt}=await module(t),journal=mintJournal(memory(),'owner-a',()=> 'stable'),attempt=journal.capture('synthetic-season',stage,now);
 const receipt={id:'synthetic-operation',kind:'mint',inventoryId:'synthetic-season',owner:'owner-a',status:'awaiting-evidence',createdAt:new Date(now).toISOString(),stageId:stage.id,termsDigest:stage.termsDigest,targetId:null,materialId:null,assetId:null,priceLamports:stage.priceLamports,costLamports:stage.costLamports,feeLamports:null};
 assert.equal(matchesMintReceipt(attempt,receipt),true);assert.equal(matchesMintReceipt(attempt,{...receipt,status:'fulfilled',assetId:'synthetic-nft'}),true);
 for(const change of [{termsDigest:undefined},{termsDigest:'b'.repeat(64)},{kind:'visual'},{owner:'owner-b'},{inventoryId:'other'},{stageId:'other'},{priceLamports:'0'},{costLamports:'0'},{feeLamports:'1'},{targetId:'other'},{materialId:'other'},{status:'unknown'},{status:'fulfilled'},{assetId:'unexpected-pending-asset'}])assert.equal(matchesMintReceipt(attempt,{...receipt,...change}),false);
 assert.equal(journal.list().length,1);
});
