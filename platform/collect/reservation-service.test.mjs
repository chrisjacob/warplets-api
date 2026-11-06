import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {seedCollectionContext} from '../application/fixtures/collection-context.mjs';
import {buildProgressionReservationCommand,createProgressionReservationService} from './reservation-service.mjs';
import {drawRequestPreimage,genesisMs,roundTime} from '../randomness/request-plan.mjs';
import {bindDraw,sha} from '../randomness/selection.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {encode58} from '../server/base58.mjs';
const crypto=createNodeCrypto(),principal={kind:'wallet',wallet:encode58(new Uint8Array(32).fill(7))};
const input=()=>({requestKey:'synthetic-reservation',kind:'upgrade',inventoryId:'synthetic-season',targetId:'target',materialId:'material',expectedTargetVersion:0,expectedMaterialVersion:0,quoteId:'stored-quote',bindingDigest:'a'.repeat(64),policyVersion:'collection-progression-v1',reviewedFeeLamports:'10000000',reviewedMaxTotalLamports:'10000000',quoteExpiresMs:2000000000000});
test('reservation identity requires exact reviewed quote and survives mutation before async hashing',async()=>{
 const original=await buildProgressionReservationCommand(principal,input(),crypto);
 for(const patch of [{quoteId:'another'},{bindingDigest:'b'.repeat(64)},{reviewedMaxTotalLamports:'20000000'},{quoteExpiresMs:2000000000001},{expectedMaterialVersion:1}])assert.notEqual((await buildProgressionReservationCommand(principal,{...input(),...patch},crypto)).requestDigest,original.requestDigest);
 for(const patch of [{quoteId:null},{bindingDigest:'BAD'},{nowMs:1},{operationId:'caller-id'},{commitment:'caller-draw'},{quote:{executable:true}},{instructions:[]},{reviewedFeeLamports:'01'}])await assert.rejects(buildProgressionReservationCommand(principal,{...input(),...patch},crypto));
 await assert.rejects(buildProgressionReservationCommand(principal,{...input(),expectedTargetVersion:Infinity},crypto),e=>e.status===400&&e.code==='invalid-progression-reservation');
 const p={...principal},value=input();let changed=false,seen;const service=createProgressionReservationService({repository:{async reserve(c){seen=c;return {kind:'pending',reason:'test-only',dependencyIds:[]};}},crypto:{...crypto,async sha256(bytes){if(!changed){changed=true;p.wallet='wrong';value.quoteId='changed';value.reviewedFeeLamports='0';}return crypto.sha256(bytes);}}});await service.reserve(p,value);assert.deepEqual(seen,original);assert.ok(Object.isFrozen(seen.input));
});
test('portable fairness request preserves exact legacy configured round and commitment bytes',async t=>{
 const db=openDatabase();t.after(()=>db.close());const f=seedCollectionContext(db),policy={policy_hash:'a'.repeat(64),registered_ms:genesisMs};db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(f.inventoryId,policy.policy_hash,'{}',policy.registered_ms);
 for(const [index,now] of [genesisMs,genesisMs+1,genesisMs+2999,genesisMs+3000,f.nowMs].entries()){
  const op={opId:'synthetic-fair-'+index,inventoryId:f.inventoryId,kind:'upgrade',owner:f.wallet,commitment:'synthetic-draw-'+index,now};db.prepare('INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) VALUES(?,?,?,?,?,?,?,?,?)').run(op.opId,op.kind,op.inventoryId,op.owner,op.opId,'synthetic',op.commitment,now,'{}');
  const plan=drawRequestPreimage(policy,op);bindDraw(db,op);const row=db.prepare('SELECT * FROM fair_requests WHERE operation_id=?').get(op.opId);
  if(index<4)assert.equal(plan.targetRound,[11,12,12,12][index]);
  if(index===0)assert.deepEqual(plan.preimage,['10x-draw-context-v1','a'.repeat(64),f.inventoryId,'synthetic-fair-0','upgrade',f.wallet,'synthetic-draw-0',1692803367000,11]);
  assert.equal(row.target_round,plan.targetRound);assert.equal(row.context_digest,await crypto.sha256(utf8(canonicalJson(plan.preimage))));assert.equal(row.context_digest,sha(plan.preimage));assert.ok(roundTime(plan.targetRound)>=now+30000);assert.ok(roundTime(plan.targetRound)<now+33000);
 }
 assert.throws(()=>drawRequestPreimage({...policy,registered_ms:f.nowMs+1},{now:f.nowMs}),/predates draw terms/);
});
