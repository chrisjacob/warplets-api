// Synthetic policy controls only; never served as live source evidence.
import {acquisitionInput,acquisitionWallet} from "./holder-acquisition-fixtures.test-helper";
import {holderHistoryFixture} from "./holder-history-fixtures.test-helper";
import {trade,key,signature} from "./wallet-fixtures.test-helper";
import {curveAddress} from "./pump";
import {toBase58} from "./solana";
import {WalletTransactionSchema} from "./wallet-rpc";
export async function participationTrade({owner=key(3),quote=10000000n,time="2026-10-21T08:30:00Z",sig=71,slot=31010,side="buy"}={}){
  const tx=await trade(owner,slot,side,sig),addresses=tx.transaction.message.accountKeys,system="11111111111111111111111111111111",curve=await curveAddress(tx.meta!.preTokenBalances[0]!.mint);
  tx.blockTime=Date.parse(time)/1000;
  if(!addresses.includes(system)){addresses.push(system);tx.meta!.preBalances.push(10000);tx.meta!.postBalances.push(10000);}
  const data=new Uint8Array(12);new DataView(data.buffer).setUint32(0,2,true);new DataView(data.buffer).setBigUint64(4,quote,true);
  tx.meta!.innerInstructions![0]!.instructions.push({programIdIndex:addresses.indexOf(system),accounts:side==="buy"?[addresses.indexOf(owner),addresses.indexOf(curve)]:[addresses.indexOf(curve),addresses.indexOf(owner)],stackHeight:2,data:toBase58(data)});
  return tx;
}
export function participationFunding(from=key(1),to=key(3),sig=80,time="2026-10-21T08:20:00Z",slot=30500){
  const data=new Uint8Array(12);new DataView(data.buffer).setUint32(0,2,true);new DataView(data.buffer).setBigUint64(4,20000000n,true);
  return WalletTransactionSchema.parse({slot,blockTime:Date.parse(time)/1000,version:0,transaction:{signatures:[signature(sig)],message:{header:{numRequiredSignatures:1},accountKeys:[from,to,"11111111111111111111111111111111"],instructions:[{programIdIndex:2,accounts:[0,1],data:toBase58(data)}]}},meta:{err:null,fee:5000,preBalances:[30005000,0,0],postBalances:[10000000,20000000,0],preTokenBalances:[],postTokenBalances:[],innerInstructions:[],loadedAddresses:{writable:[],readonly:[]}}});
}
export async function participationFixture(){return acquisitionInput(await holderHistoryFixture(),await acquisitionWallet([await participationTrade()]));}
