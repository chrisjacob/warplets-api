import test from 'node:test';
import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createCollectionEdgeFixture} from '../../application/fixtures/collection-edges.mjs';
import {encode58} from '../../server/base58.mjs';
import {observeCollectionAsset} from '../../collect/store.mjs';
async function actor(f,account){
 let cookie='';const call=async(path,body,requestKey)=>{
  const response=await fetch(f.origin+'/api/v1'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:f.origin,'content-type':'application/json',cookie,...(requestKey?{'idempotency-key':requestKey}:{})}});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,value:await response.json()};
 };
 const {value:c}=await call('/auth/challenges',{wallet:account.wallet});assert.equal((await call('/auth/verify',{nonce:c.nonce,signature:encode58(sign(null,Buffer.from(c.message),account.privateKey))})).status,200);return call;
}
test('real collection API keeps late accepted eligibility bound to opening ownership and reveal, not current holdings',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());
 const actors=Object.fromEntries(await Promise.all(Object.entries(f.accounts).map(async([key,account])=>[key,await actor(f,account)])));
 const path='/collect/inventories/'+f.seasonId,stage=body=>body.stages.find(s=>s.id==='synthetic-free');
 const before=stage((await actors.original(path)).value);assert.equal(before.eligible,null);assert.equal(before.eligibility.reason,'opening-snapshot-pending');
 assert.throws(()=>f.acceptSnapshot({...f.snapshot,holdings:f.snapshot.holdings.slice(0,1)}),e=>e.code==='conflicting_ownership_cut');
 assert.throws(()=>f.acceptSnapshot({...f.snapshot,holdings:f.snapshot.holdings.map((n,i)=>i===0?{...n,owner:f.accounts.buyer.wallet}:n)}),e=>e.code==='conflicting_ownership_cut');
 assert.throws(()=>f.acceptSnapshot({...f.snapshot,at:f.cut+500}),e=>e.code==='wrong_free_snapshot_boundary');
 assert.equal(f.acceptSnapshot().eligibleWallets,1);assert.equal(f.acceptSnapshot().replayed,true);
 for(const [name,call] of Object.entries(actors)){
  const current=stage((await call(path)).value);assert.equal(current.eligible,name==='original');assert.equal(current.eligibility.cutoffAt,new Date(f.cut).toISOString());
  assert.equal(current.termsDigest,before.termsDigest);assert.notEqual(current.eligibility.cutoffAt,new Date(f.nowMs).toISOString());
 }
 assert.throws(()=>f.acceptSnapshot({...f.snapshot,sourceRef:'synthetic-corrected-after-publication'}),e=>e.code==='snapshot_conflict');
 const reserve=path+'/stages/synthetic-free/reservations',first=await actors.original(reserve,{},'synthetic-free-once');assert.equal(first.status,201);assert.equal(first.value.operation.priceLamports,'0');
 assert.equal((await actors.original(reserve,{},'synthetic-free-once')).value.operation.id,first.value.operation.id);
 assert.equal((await actors.original(reserve,{},'synthetic-free-twice')).value.error.code,'stage_wallet_limit');
 assert.equal((await actors.buyer(reserve,{},'synthetic-current-owner')).status,403);
});

test('real progression API reactivates an expired pair and preserves historical allocation, claims and cooldown through reroll and transfer',async t=>{
 const f=await createCollectionEdgeFixture({assetCount:2});t.after(()=>f.close());const original=await actor(f,f.accounts.original),buyer=await actor(f,f.accounts.buyer);
 const asset=id=>'/collect/assets/'+id,path='/collect/inventories/'+f.seasonId+'/progression';
 const before=(await original(asset('synthetic-season-000'))).value,historical=f.historical(),vault=(await original('/nfts/synthetic-season-000/vault')).value;
 assert.ok(Date.parse(before.expiresAt)<f.nowMs);
 const request={kind:'upgrade',targetId:'synthetic-season-000',materialId:'synthetic-season-001',expectedTargetVersion:0,expectedMaterialVersion:0};
 const quote=(await original(path+'/quote',request)).value;assert.equal(quote.nextTargetLevel,2);assert.ok(Date.parse(quote.nextTargetExpiry)>f.nowMs);
 assert.equal(quote.materialProbabilities[0].remainingMs,0);assert.equal(quote.materialProbabilities.reduce((n,row)=>n+row.count,0),1000);
 const pending=await original(path,request,'synthetic-upgrade');assert.equal(pending.status,201);assert.equal((await original(path,request,'synthetic-upgrade')).value.operation.id,pending.value.operation.id);
 f.fulfill(pending.value.operation.id);assert.equal(f.fulfill(pending.value.operation.id).replayed,true);
 const after=(await original(asset(request.targetId))).value,material=(await original(asset(request.materialId))).value;
 assert.equal(after.level,2);assert.equal(after.expiresAt,quote.nextTargetExpiry);assert.deepEqual(after.traits,before.traits);assert.equal(material.level,1);assert.ok(Date.parse(material.expiresAt)<f.nowMs);
 assert.equal(f.historical(),historical);assert.deepEqual((await original('/nfts/synthetic-season-000/vault')).value,vault);
 const visual={kind:'visual',targetId:request.targetId,expectedTargetVersion:after.version},reroll=await original(path,visual,'synthetic-reroll');assert.equal(reroll.status,201);
 f.fulfill(reroll.value.operation.id,{traits:{model:'Synthetic new model',backdrop:'Synthetic new backdrop',symbol:'Synthetic new symbol'}});
 const rerolled=(await original(asset(request.targetId))).value;assert.equal(rerolled.level,2);assert.equal(rerolled.rerolls,1);assert.equal(Date.parse(rerolled.nextRerollAt),f.nowMs+3600000);
 observeCollectionAsset(f.db,{sourceId:'synthetic-transfer-rerolled',assetId:request.targetId,kind:'transfer',from:f.accounts.original.wallet,to:f.accounts.buyer.wallet,at:f.nowMs,finalized:true},f.nowMs);
 const moved=(await buyer(asset(request.targetId))).value;assert.equal(moved.rerolls,1);assert.equal(moved.nextRerollAt,rerolled.nextRerollAt);
 assert.equal((await buyer(path+'/quote',{...visual,expectedTargetVersion:moved.version})).value.error.code,'reroll_cooldown');assert.equal(f.historical(),historical);
});

test('every upgrade starting Level preserves historical entitlements through target increase, material downgrade and visual reroll',async()=>{
 for(let level=1;level<=9;level++){
  const f=await createCollectionEdgeFixture({assetCount:2,seasonLevel:level});
  try{
   const call=await actor(f,f.accounts.original),path='/collect/inventories/'+f.seasonId+'/progression',targetId='synthetic-season-000',materialId='synthetic-season-001';
   const historical=f.historical(),oldTarget=(await call('/collect/assets/'+targetId)).value,oldMaterial=(await call('/collect/assets/'+materialId)).value;
   const claims=await Promise.all([targetId,materialId].map(async id=>(await call('/nfts/'+id+'/vault')).value));assert.equal(oldTarget.level,level);assert.equal(oldMaterial.level,level);
   const request={kind:'upgrade',targetId,materialId,expectedTargetVersion:0,expectedMaterialVersion:0},quote=(await call(path+'/quote',request)).value;
   assert.equal(quote.feeLamports,String(BigInt(level)*10000000n));assert.equal(quote.nextTargetLevel,level+1);
   const admitted=await call(path,request,'synthetic-level-'+level);assert.equal(admitted.status,201);f.fulfill(admitted.value.operation.id);
   const target=(await call('/collect/assets/'+targetId)).value,material=(await call('/collect/assets/'+materialId)).value;
   assert.equal(target.level,level+1);assert.equal(target.expiresAt,quote.nextTargetExpiry);assert.deepEqual(target.traits,oldTarget.traits);
   assert.equal(material.level,1);assert.deepEqual(material.traits,oldMaterial.traits);assert.ok(Date.parse(material.expiresAt)<=Date.parse(oldMaterial.expiresAt));
   const visual=await call(path,{kind:'visual',targetId,expectedTargetVersion:target.version},'synthetic-visual-'+level);assert.equal(visual.status,201);
   f.fulfill(visual.value.operation.id,{traits:{model:'Synthetic changed model',backdrop:'Synthetic changed backdrop',symbol:'Synthetic changed symbol'}});
   const rerolled=(await call('/collect/assets/'+targetId)).value;assert.equal(rerolled.level,level+1);assert.equal(rerolled.expiresAt,target.expiresAt);assert.equal(rerolled.rerolls,1);
   assert.equal(f.historical(),historical);assert.deepEqual(await Promise.all([targetId,materialId].map(async id=>(await call('/nfts/'+id+'/vault')).value)),claims);
  }finally{await f.close();}
 }
});
