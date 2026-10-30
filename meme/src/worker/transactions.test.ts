import test from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './testDb';
import { sha } from './db';
import { canonical } from '../shared/canonical';
import type { TransactionPlan, TransactionReadAdapter } from '../shared/transactions';
import { prepareIntent, simulateIntent, beginHandoff, recordSignature, reconcileIntent, getIntent } from './transactions';
const wallet = '11111111111111111111111111111111', signature = '2'.repeat(88);
function plan(subject='allocation:1'):TransactionPlan { return {version:1,network:'solana-local',operation:'claim',subject,businessKey:'solana-local:claim:'+subject,signers:[wallet],instructions:[{program:wallet,accounts:[wallet],data:'0102',description:'Local fixture only'}],expected:{amount:'100',wallet},maximumCost:'2000000',costUnit:'lamports',notBefore:Date.now()-1,expiresAt:Date.now()+120000,simulated:true}; }
function adapter(p:TransactionPlan, change:Partial<TransactionReadAdapter>={}):TransactionReadAdapter { return { simulate:async(_,h)=>({planHash:h,success:true,cost:'5000',context:'local-slot:1',expectedHash:await sha(canonical(p.expected)),observedAt:Date.now()}), inspect:async(_,h,s)=>({status:'finalized',network:p.network,planHash:h,signature:s,expectedHash:await sha(canonical(p.expected)),context:'local-slot:2',expired:false,complete:true}), ...change }; }
test('lost response after durable preparation preserves one immutable business operation',async()=>{
  const t=testDb(); try { const p=plan(); t.interruptNextBatch(); await assert.rejects(prepareIntent(t.db,p),/lost response/); const i=await prepareIntent(t.db,p); assert.equal((await prepareIntent(t.db,p)).id,i.id); await assert.rejects(prepareIntent(t.db,{...p,maximumCost:'1'}),/different immutable/); assert.equal(t.raw.prepare('SELECT COUNT(*) n FROM meme_transaction_intents').get()!.n,1); }finally{t.close();}
});
test('concurrent wallet handoffs have a single winner and ambiguity blocks all repeats',async()=>{
  const t=testDb();try{const p=plan(),i=await prepareIntent(t.db,p),a=adapter(p);await simulateIntent(t.db,i.id,a);const attempts=await Promise.allSettled([beginHandoff(t.db,i.id),beginHandoff(t.db,i.id)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(beginHandoff(t.db,i.id));assert.equal((await getIntent(t.db,i.id)).state,'unknown');}finally{t.close();}
});
test('confirmed claims are idempotent, append-only and cannot be confirmed by unrelated evidence',async()=>{
  const t=testDb();try{const p=plan(),i=await prepareIntent(t.db,p),a=adapter(p);await simulateIntent(t.db,i.id,a);await beginHandoff(t.db,i.id);await recordSignature(t.db,i.id,signature);await assert.rejects(reconcileIntent(t.db,i.id,adapter(p,{inspect:async()=>({status:'finalized',network:'base-mainnet',planHash:'changed',signature,expectedHash:'wrong',context:'fake',expired:false,complete:true})})),/does not match/);assert.equal((await reconcileIntent(t.db,i.id,a)).state,'confirmed');assert.equal((await reconcileIntent(t.db,i.id,a)).state,'confirmed');assert.equal(t.raw.prepare('SELECT COUNT(*) n FROM meme_financial_receipts').get()!.n,1);assert.throws(()=>t.raw.exec("UPDATE meme_financial_receipts SET evidence_hash='changed'"),/immutable/);}finally{t.close();}
});
test('unreleased claims and mainnet packets cannot reach a signing handoff',async()=>{
  const t=testDb();try{const p={...plan(),notBefore:Date.now()+30000};const i=await prepareIntent(t.db,p);await simulateIntent(t.db,i.id,adapter(p));await assert.rejects(beginHandoff(t.db,i.id),/not released/);const m={...plan('mainnet'),network:'solana-mainnet' as const,businessKey:'solana-mainnet:claim:mainnet',simulated:false};const mi=await prepareIntent(t.db,m);await simulateIntent(t.db,mi.id,adapter(m));await assert.rejects(beginHandoff(t.db,mi.id),/Mainnet/);}finally{t.close();}
});
test('simulation exceeding the budget and incomplete absence cannot authorize a retry',async()=>{
  const t=testDb();try{const p=plan(),i=await prepareIntent(t.db,p);await assert.rejects(simulateIntent(t.db,i.id,adapter(p,{simulate:async(_,h)=>({planHash:h,success:true,cost:'2000001',context:'local',expectedHash:await sha(canonical(p.expected)),observedAt:Date.now()})})),/ceiling/);await simulateIntent(t.db,i.id,adapter(p));await beginHandoff(t.db,i.id);const a=adapter(p,{inspect:async(_,h)=>({status:'absent',network:p.network,planHash:h,signature:null,expectedHash:await sha(canonical(p.expected)),context:'local',expired:true,complete:false})});assert.equal((await reconcileIntent(t.db,i.id,a)).state,'unknown');}finally{t.close();}
});
