import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Keypair,Transaction,ComputeBudgetProgram,Connection} from '@solana/web3.js';
import {buildAction,verifyEffects} from '../protocols.mjs';
import {actions} from '../catalogue.mjs';
import * as sdk from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';

const payer=Keypair.generate(),connection=new Connection('http://127.0.0.1:1');
connection.getMinimumBalanceForRentExemption=async()=>2000000;
connection.getAccountInfo=async()=>null;
connection.getMultipleAccountsInfo=async keys=>keys.map(()=>null);
connection.getLatestBlockhash=async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100});
const artifacts={original:{mint:Keypair.generate().publicKey.toBase58()},attention:{mint:Keypair.generate().publicKey.toBase58()},nft:{asset:Keypair.generate().publicKey.toBase58()}};
const build=action=>buildAction({action,payer:payer.publicKey.toBase58(),recipient:Keypair.generate().publicKey.toBase58(),artifacts,label:'qa-aabbccdd-'+action,connection,chainTime:1800000000});
for(const action of ['original','attention','token-transfer','pool','allocation','distribution','nft','nft-transfer'])test(action+' uses a real builder and fits one packet without payer signing',async()=>{
  const plan=await build(action);const tx=new Transaction({feePayer:payer.publicKey,...await connection.getLatestBlockhash()}).add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...plan.ixs);
  if(plan.signers.length)tx.partialSign(...plan.signers);
  const bytes=tx.serialize({requireAllSignatures:false});assert(bytes.length<=1232);assert.equal(tx.signatures[0].signature,null);assert.equal(plan.signers.some(k=>k.publicKey.equals(payer.publicKey)),false);
  if(action==='pool') {
    const vector=JSON.parse(readFileSync(new URL('../../../lab/fixtures/damm-v2-prd-vector.json',import.meta.url)));
    const instructions=plan.ixs.filter(i=>i.programId.toBase58()===vector.program);
    assert.equal(instructions.length,2);assert.equal(instructions[0].data.subarray(8,35).toString('hex'),vector.baseFeeHex);
    assert.equal(instructions[0].data.readBigUInt64LE(107),1800000060n);
  }
  if(action==='distribution') {artifacts.distribution=plan.result;const claim=await build('claim');assert(claim.ixs.some(i=>i.data[0]===6));}
});
test('receipt token delta rejects absent or insufficient payment evidence',async()=>{
  const expected=[{kind:'token-delta',address:'destination',minimum:'10'}];
  const receipt={transaction:{message:{accountKeys:['destination']}},meta:{preTokenBalances:[],postTokenBalances:[{accountIndex:0,uiTokenAmount:{amount:'9'}}]}};
  await assert.rejects(verifyEffects({},expected,receipt),/delta/);receipt.meta.postTokenBalances[0].uiTokenAmount.amount='10';assert.equal((await verifyEffects({},expected,receipt))[0].observedDelta,'10');
});
test('catalogue never exposes unknown transactions or unreviewed custody as supported actions',()=>{
  assert.equal(actions.some(a=>['P04','P07','P08','P09','P10'].includes(a.poc)),false);
  assert.equal(new Set(actions.map(a=>a.id)).size,actions.length);
});
test('swap/fee adapters use real SDK builders with a controlled quote and protocol position PDA',async()=>{
  const pool=await build('pool');artifacts.pool=pool.result;
  const originalFetch=sdk.CpAmm.prototype.fetchPoolState,originalQuote=sdk.CpAmm.prototype.getQuote;
  const state={tokenAVault:Keypair.generate().publicKey,tokenBVault:Keypair.generate().publicKey,poolFees:{baseFee:{baseFeeInfo:{data:Array(32).fill(0)}}}};
  sdk.CpAmm.prototype.fetchPoolState=async()=>state;
  sdk.CpAmm.prototype.getQuote=function(params){assert.equal(params.slippage,1);return {swapInAmount:new BN(1000000),minSwapOutAmount:new BN(100),swapOutAmount:new BN(102)};};
  connection.getSlot=async()=>100;
  try{
    for(const action of ['buy','sell','fees']) {
      const plan=await buildAction({action,payer:payer.publicKey.toBase58(),artifacts,label:'qa-aabbccdd-'+action,connection,chainTime:1800000200});
      const tx=new Transaction({feePayer:payer.publicKey,...await connection.getLatestBlockhash()}).add(ComputeBudgetProgram.setComputeUnitLimit({units:600000}),...plan.ixs);
      assert(tx.serialize({requireAllSignatures:false}).length<=1232);
      if(action==='fees')assert(plan.ixs.some(i=>i.keys.some(k=>k.pubkey.equals(sdk.derivePositionNftAccount(new (payer.publicKey.constructor)(artifacts.pool.positionNft))))));
      else assert.equal(plan.expect.find(e=>e.kind==='token-delta').minimum,'100');
    }
  }finally{sdk.CpAmm.prototype.fetchPoolState=originalFetch;sdk.CpAmm.prototype.getQuote=originalQuote;}
});
