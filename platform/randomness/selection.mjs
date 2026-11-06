import {createHash} from 'node:crypto';
import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {canonical} from '../transactions/canonical.mjs';
import {LEVEL_QUOTAS,drawLevel} from '../domain/collections/policy.mjs';
import {CHAIN,genesisMs,periodMs,leadMs,roundTime,futureRound,drawRequestPreimage} from './request-plan.mjs';

export {CHAIN,genesisMs,periodMs,leadMs,roundTime,futureRound};
export const sha=value=>createHash('sha256').update(canonical(value)).digest('hex');
const traitFields=['model','backdrop','symbol'];
function validateTraits(rows){
 for(const field of traitFields){
  const options=rows?.[field];
  if(!Array.isArray(options)||!options.length||options.length>256)throw Error('Provide weighted choices for '+field);
  const names=new Set();for(const item of options){
   if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>128||names.has(item.name)||
     !Number.isInteger(item.weight)||item.weight<1||item.weight>1000000)throw Error('Invalid weighted trait.');
   names.add(item.name);
  }
 }
 return Object.fromEntries(traitFields.map(field=>[field,rows[field].map(({name,weight})=>({name,weight}))]));
}
export function publishDrawPolicy(db,{inventoryId,assets,traitChoices,at},now=Date.now()){
 if(!Number.isSafeInteger(at)||at>now||at<genesisMs)throw Error('Invalid publication time.');
 if(!Array.isArray(assets)||assets.length!==1000||new Set(assets).size!==assets.length)throw Error('Commit to 1,000 distinct asset IDs.');
 assets.forEach(a=>decode58(a,32));const traits=validateTraits(traitChoices);
 const digest=sha(['10x-lab-draw-1',inventoryId,CHAIN,leadMs,at,assets,LEVEL_QUOTAS,traits]);
 return transaction(db,()=>{
  const old=db.prepare('SELECT policy_hash FROM fair_inventories WHERE inventory_id=?').get(inventoryId);
  if(old){if(old.policy_hash!==digest)throw Error('Draw policy is immutable.');return digest;}
  if(db.prepare('SELECT 1 FROM collect_operations WHERE inventory_id=? LIMIT 1').get(inventoryId))
    throw Error('Publish the policy before taking reservations.');
  db.prepare('INSERT INTO fair_inventories VALUES(?,?,?,?)').run(inventoryId,digest,canonical(traits),at);
  const insert=db.prepare('INSERT INTO fair_reserved_assets VALUES(?,?,?)');
  assets.forEach((asset,i)=>insert.run(inventoryId,i,asset));return digest;
 });
}
export function bindDraw(db,op){
 const rules=db.prepare('SELECT policy_hash,registered_ms FROM fair_inventories WHERE inventory_id=?').get(op.inventoryId);
 if(!rules)return;
 const {targetRound,preimage}=drawRequestPreimage(rules,op);
 db.prepare('INSERT INTO fair_requests VALUES(?,?,?)').run(op.opId,targetRound,sha(preimage));
}
// A draw configured for verified entropy cannot fall back to the manual fixture path.
export function requireBoundResult(db,op,fixture){
 const req=db.prepare('SELECT target_round FROM fair_requests WHERE operation_id=?').get(op.id);
 if(!req)return;
 const stored=db.prepare('SELECT proof_id,fixture FROM fair_results WHERE operation_id=?').get(op.id);
 if(!stored||stored.proof_id!==fixture.proofId||stored.fixture!==canonical(fixture))throw Error('Verified draw receipt required.');
}
export function uniform(seed,label,size){
 if(!Number.isSafeInteger(size)||size<1)throw Error('Invalid draw range.');
 const n=BigInt(size),range=1n<<256n,limit=range-range%n;
 for(let i=0;i<256;i++){
  const x=BigInt('0x'+sha(['10x-uniform-v1',seed,label,i]));
  if(x<limit)return Number(x%n);
 }
 throw Error('Random sample exhausted; retain the same commitment.');
}
export function materializeDraw(db,op,request,randomness,when){
 const policy=db.prepare('SELECT * FROM fair_inventories WHERE inventory_id=?').get(op.inventory_id);
 const traits=JSON.parse(policy.traits),seed=sha(['10x-beacon-v1',request.context_digest,randomness]);
 const output={operationId:op.id,commitment:op.commitment,proofId:sha([CHAIN,request.target_round,seed]),at:when,finalized:true};
 if(op.kind==='mint'||op.kind==='visual')output.traits=Object.fromEntries(traitFields.map(key=>{
  const choices=traits[key],total=choices.reduce((sum,c)=>sum+c.weight,0);
  let pick=uniform(seed,key,total);
  for(const choice of choices){if(pick<choice.weight)return [key,choice.name];pick-=choice.weight;}
  throw Error('Invalid trait weights.');
 }));
 if(op.kind==='upgrade')output.ticket=uniform(seed,'upgrade-level',1000);
 if(op.kind==='mint'){
  const row=db.prepare('SELECT state FROM collect_inventories WHERE id=?').get(op.inventory_id),state=JSON.parse(row.state);
  if(state.admissions[state.fulfilled]?.operationId!==op.id)throw Error('Settle earlier admissions first.');
  output.ticket=uniform(seed,'initial-level',1000-state.fulfilled);
  const level=drawLevel(state.remaining,output.ticket);
  const slot=LEVEL_QUOTAS.slice(0,level-1).reduce((sum,n)=>sum+n,0)+LEVEL_QUOTAS[level-1]-state.remaining[level-1];
  output.assetId=db.prepare('SELECT asset_id FROM fair_reserved_assets WHERE inventory_id=? AND slot_index=?').get(op.inventory_id,slot).asset_id;
 }
 return output;
}
