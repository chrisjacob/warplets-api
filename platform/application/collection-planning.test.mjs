import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createMintReservationCommand,planMintReservation} from './collection-planning.mjs';
import {createInventory,publishStage,admitMint,prepareMintAdmission} from '../domain/collections/inventory.mjs';
import {encode58} from '../server/base58.mjs';
const crypto={sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')},termsDigest='a'.repeat(64),sourceId='b'.repeat(64),at=180000000;
const wallet=n=>encode58(Buffer.from(Array.from({length:32},(_,index)=>index===31?n:1)));
const context=(state,owner,stageId,operationId,commitment)=>{
 const stage=state.stages.find(row=>row.id===stageId),same=state.admissions.filter(row=>row.stageId===stageId);
 return {inventoryId:state.id,inventoryRevision:String(state.version),stage:{...stage,priceLamports:stage.priceLamports.toString(),costLamports:'5000',approvedSpendLamports:stage.approvedSpendLamports?.toString()??null,termsDigest},slots:state.slots,admissionCount:state.admissions.length,stageAdmissionCount:same.length,walletAdmissionCount:same.filter(row=>row.wallet===owner).length,founderSpentLamports:same.reduce((sum,row)=>sum+row.costLamports,0n).toString(),membership:{wallet:owner,stageId,eligible:stage.type==='public'||stage.wallets.includes(owner),sourceId},priorOperation:null,commitmentUsed:state.admissions.some(row=>row.drawCommitment===commitment)};
};
const command=(owner,stageId,requestKey='request')=>createMintReservationCommand({principal:{kind:'wallet',wallet:owner},requestKey,nowMs:at,expectedRevisions:{source:'0'},input:{kind:'mint',inventoryId:'synthetic-planner',stageId,expectedTermsDigest:termsDigest}},{crypto});
test('sufficient-fact plans match complete reference histories across 1000 admissions and shared stage limits',async()=>{
 const wallets=Array.from({length:100},(_,n)=>wallet(n)),stages=Array.from({length:10},(_,n)=>'stage-'+n);let state=createInventory({id:'synthetic-planner',kind:'genesis',tranche:1});
 for(const id of stages)state=publishStage(state,{id,type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:100,wallets,walletLimit:1});
 for(let n=0;n<1000;n++){
  const owner=wallets[n%100],stageId=stages[Math.floor(n/100)],operationId='operation-'+n,commitment='commitment-'+n,c=await command(owner,stageId,'request-'+n),facts=context(state,owner,stageId,operationId,commitment),plan=planMintReservation(c,facts,{operationId,commitment});
  const next=admitMint(state,{operationId,wallet:owner,stageId,at,drawCommitment:commitment,costLamports:5000n});
  assert.deepEqual(plan.admission,{...next.admissions.at(-1),costLamports:'5000'});assert.deepEqual(plan.effects,{inventoryAdmissionDelta:1,stageAdmissionDelta:1,walletAdmissionDelta:1});assert.ok(Buffer.byteLength(JSON.stringify(plan))<2048);state=next;
 }
 const facts=context(state,wallets[0],stages[0],'overflow','overflow');
 const final=await command(wallets[0],stages[0]);assert.throws(()=>planMintReservation(final,facts,{operationId:'overflow',commitment:'overflow'}),error=>error.code==='stage_wallet_limit');
});
test('membership identities, terms, malformed counters and absent sealed membership fail closed',async()=>{
 let state=createInventory({id:'synthetic-planner',kind:'genesis',tranche:1});state=publishStage(state,{id:'first',type:'whitelist',publishedAt:0,opensAt:172800000,closesAt:200000000,priceLamports:100000000n,allocation:1000,wallets:[wallet(1)],walletLimit:1});
 const c=await command(wallet(1),'first'),facts=context(state,wallet(1),'first','operation','commitment');
 for(const mutate of [f=>f.membership.wallet=wallet(2),f=>f.membership.sourceId=null,f=>f.stage.termsDigest='c'.repeat(64),f=>f.walletAdmissionCount=1]){const changed=structuredClone(facts);mutate(changed);assert.throws(()=>planMintReservation(c,changed,{operationId:'operation',commitment:'commitment'}));}
 const denied={...facts,membership:{...facts.membership,eligible:false}};assert.throws(()=>planMintReservation(c,denied,{operationId:'operation',commitment:'commitment'}),error=>error.code==='wallet_ineligible');
});
test('command input is immutable across digest awaits and accepted domain replay ignores later stage time/capacity',async()=>{
 const args={principal:{kind:'wallet',wallet:wallet(1)},requestKey:'same',nowMs:at,expectedRevisions:{source:'0'},input:{kind:'mint',inventoryId:'synthetic-planner',stageId:'first',expectedTermsDigest:termsDigest}};
 const c=await createMintReservationCommand(args,{crypto:{sha256:async bytes=>{args.input.stageId='changed';args.principal.wallet=wallet(2);return crypto.sha256(bytes);}}});assert.equal(c.input.stageId,'first');assert.equal(c.principal.wallet,wallet(1));assert.throws(()=>{c.input.stageId='mutated';},TypeError);
 const admission={operationId:'original',wallet:wallet(1),stageId:'first',drawCommitment:'commitment',admittedAt:at,costLamports:5000n,level:null,proofId:null,ticket:null};
 const result=prepareMintAdmission({priorOperation:admission},{operationId:'original',wallet:wallet(1),stageId:'first',drawCommitment:'commitment',at:at+100000000,costLamports:5000n});assert.equal(result.replayed,true);assert.equal(result.admission,admission);
 assert.throws(()=>prepareMintAdmission({priorOperation:admission},{operationId:'original',wallet:wallet(2),stageId:'first',drawCommitment:'commitment',at,costLamports:5000n}),error=>error.code==='conflicting_mint_retry');
});
