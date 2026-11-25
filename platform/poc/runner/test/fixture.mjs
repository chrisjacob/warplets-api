// In-memory chain only. No network and no operational wallet keys.
import {Keypair,Transaction} from '@solana/web3.js';
import {Store} from '../store.mjs';
import {Engine} from '../engine.mjs';
import {GENESIS} from '../chain.mjs';
import {buildAction} from '../protocols.mjs';
import {base58} from '../../create-wallets.mjs';

export function fixture(store=new Store()) {
  const payer=Keypair.generate();
  const control={genesis:GENESIS,price:100,height:10,cost:2_000_000,sendCount:0,finalized:false,timeout:false,err:null,verificationError:false};
  const connection={
    getGenesisHash:async()=>control.genesis,
    getMinimumBalanceForRentExemption:async size=>size*6000+500000,
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:100}),
    getFeeForMessage:async()=>({value:5000}),getBlockHeight:async()=>control.height,
    getSignatureStatuses:async()=>({value:[control.finalized?{confirmationStatus:'finalized',err:control.err}:null]}),
    sendRawTransaction:async raw=>{control.sendCount++;control.tx=Transaction.from(raw);if(control.timeout)throw Error('Mock timeout after network handoff');return base58(control.tx.signature);},
  };
  const chain={connection,observePrograms:async()=>({genesis:control.genesis,programs:[]}),
    quoteSolUsd:async()=>({usdPerSol:control.price,observedAt:new Date().toISOString(),source:'mock'}),chainClock:async()=>1800000000,
    balance:async()=>({context:{slot:10},value:{lamports:1000000000}}),
    simulate:async()=>({context:{slot:11},value:{err:control.simulationError??null,accounts:[{lamports:1000000000-control.cost}],unitsConsumed:50000,logs:['MOCK simulation']}}),
    receipt:async signature=>{
      const message=control.tx.compileMessage();
      const result={slot:20,transaction:{signatures:[signature],message:{header:message.header,accountKeys:message.accountKeys.map(k=>k.toBase58()),recentBlockhash:message.recentBlockhash,instructions:message.instructions}},meta:{err:control.err,fee:5000,preBalances:message.accountKeys.map(()=>1000000000),postBalances:message.accountKeys.map((_,i)=>i===0?1000000000-control.cost:1000000000),preTokenBalances:[],postTokenBalances:[]}};
      if(control.forge)result.transaction.message.recentBlockhash=Keypair.generate().publicKey.toBase58();
      return result;
    },
  };
  const verify=async()=>{if(control.verificationError)throw Error('Mock effect mismatch');return [{mock:true}];};
  const engine=new Engine(store,chain,buildAction,verify);
  const prepare=(action='original',extra={})=>engine.prepare({action,payer:payer.publicKey.toBase58(),...extra});
  const sign=attempt=>{const tx=Transaction.from(Buffer.from(attempt.packet,'base64'));tx.partialSign(payer);return tx.serialize().toString('base64');};
  return {payer,store,engine,chain,control,prepare,sign,verify};
}
