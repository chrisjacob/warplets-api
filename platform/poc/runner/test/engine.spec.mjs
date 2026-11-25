import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transaction,Keypair} from '@solana/web3.js';
import {Store} from '../store.mjs';
import {Engine,validateSigned} from '../engine.mjs';
import {fixture} from './fixture.mjs';

test('prepare simulates, requires payer signature, and reserves the entire run',async()=>{
  const f=fixture();try{const a=await f.prepare();assert.equal(f.control.sendCount,0);assert(a.reservedUsd>0);assert(a.messageHash);assert.throws(()=>validateSigned(a,a.packet),/signature/);await assert.rejects(f.prepare(),/pending/);}finally{f.store.close();}
});
test('wrong chain, overspend, simulation failure and dependency bypass fail closed',async()=>{
  const f=fixture();try{
    f.control.genesis='devnet';await assert.rejects(f.prepare(),/Wrong chain/);f.control.genesis=f.chain.expected;
    const other=fixture();f.control.genesis=await other.chain.connection.getGenesisHash();other.store.close();
    f.control.price=10000;await assert.rejects(f.prepare(),/budget/);f.control.price=100;
    f.control.simulationError={InstructionError:[0,1]};await assert.rejects(f.prepare(),/Simulation/);f.control.simulationError=null;
    await assert.rejects(f.prepare('pool'),/Complete/);assert.equal(f.store.value.attempts.length,0);
  }finally{f.store.close();}
});
test('wallet message mutation and other signer are rejected before broadcast',async()=>{
  const f=fixture();try{const a=await f.prepare(),tx=Transaction.from(Buffer.from(a.packet,'base64'));tx.recentBlockhash=Keypair.generate().publicKey.toBase58();
    await assert.rejects(f.engine.submit(a.id,tx.serialize({requireAllSignatures:false,verifySignatures:false}).toString('base64')),/changed/);
    assert.equal(f.control.sendCount,0);
  }finally{f.store.close();}
});
test('successful finalized receipt accounts once and duplicate submit never broadcasts twice',async()=>{
  const f=fixture();try{const a=await f.prepare();f.control.finalized=true;const signed=f.sign(a);
    assert.equal((await f.engine.submit(a.id,signed)).status,'finalized');assert(f.store.value.artifacts.original);
    const spent=f.store.value.spentUsd;await f.engine.submit(a.id,signed);await f.engine.recover(a.id);assert.equal(f.control.sendCount,1);assert.equal(f.store.value.spentUsd,spent);
    await assert.rejects(f.prepare(),/already finalized/);
  }finally{f.store.close();}
});
test('ambiguous broadcast survives restart and cannot be replaced or resent',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'poc-recovery-'));let store=new Store(join(dir,'state.sqlite'));const f=fixture(store);
  try{const a=await f.prepare(),signed=f.sign(a);f.control.timeout=true;assert.equal((await f.engine.submit(a.id,signed)).status,'unknown');store.close();store=new Store(join(dir,'state.sqlite'));
    const engine=new Engine(store,f.chain,undefined,f.verify);f.control.height=999;
    assert.equal((await engine.recover(a.id)).status,'unknown');await assert.rejects(engine.prepare({action:'original',payer:f.payer.publicKey.toBase58()}),/pending/);
    await engine.submit(a.id,signed);assert.equal(f.control.sendCount,1);
    f.control.finalized=true;assert.equal((await engine.recover(a.id)).status,'finalized');assert.equal(f.control.sendCount,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('unsigned expiry, late signature and wallet change cannot reuse an expired attempt',async()=>{
  const f=fixture();try{const a=await f.prepare();f.control.height=101;assert.equal((await f.engine.recover(a.id)).status,'expired');await assert.rejects(f.engine.submit(a.id,f.sign(a)),/not signable/);
    await assert.rejects(f.engine.prepare({action:'original',payer:Keypair.generate().publicKey.toBase58()}),/Reconnect/);
    assert.equal(f.control.sendCount,0);
  }finally{f.store.close();}
});
test('finalized failure charges fees and does not publish an artifact',async()=>{
  const f=fixture();try{const a=await f.prepare();f.control.cost=5000;f.control.err={InstructionError:[1,1]};f.control.finalized=true;
    assert.equal((await f.engine.submit(a.id,f.sign(a))).status,'failed');assert.equal(f.store.value.spentLamports,5000);assert.equal(f.store.value.artifacts.original,undefined);
  }finally{f.store.close();}
});
test('forged receipt and failed postcondition preserve unresolved state',async()=>{
  const f=fixture();try{const a=await f.prepare();f.control.finalized=true;f.control.forge=true;
    await assert.rejects(f.engine.submit(a.id,f.sign(a)),/Receipt message mismatch/);assert.equal(f.store.value.spentLamports,0);
    f.control.forge=false;f.control.verificationError=true;assert.equal((await f.engine.recover(a.id)).status,'verification-failed');
    assert.equal(f.store.value.artifacts.original,undefined);await assert.rejects(f.prepare(),/pending/);
    const spent=f.store.value.spentUsd;f.control.verificationError=false;await f.engine.recover(a.id);assert.equal(f.store.value.spentUsd,spent);
  }finally{f.store.close();}
});
test('realized overspend holds future preparations and concurrency is serialized',async()=>{
  const f=fixture();try{const [a,b]=await Promise.allSettled([f.prepare(),f.prepare()]);assert.equal(a.status,'fulfilled');assert.equal(b.status,'rejected');
    f.control.finalized=true;const original=f.chain.receipt;f.chain.receipt=async signature=>{f.control.cost=5_000_000;return original(signature);};await f.engine.submit(a.value.id,f.sign(a.value));assert(f.store.value.hold);await assert.rejects(f.prepare('attention'),/hold/);
  }finally{f.store.close();}
});
test('fresh simulation or price change beyond the reviewed reserve prevents broadcast',async()=>{
  const f=fixture();try{const a=await f.prepare();f.control.cost=5_000_000;await assert.rejects(f.engine.submit(a.id,f.sign(a)),/reviewed reserve/);f.control.cost=2_000_000;f.control.price=1000;await assert.rejects(f.engine.submit(a.id,f.sign(a)),/reviewed reserve/);assert.equal(f.control.sendCount,0);assert.equal(a.status,'prepared');}finally{f.store.close();}
});
