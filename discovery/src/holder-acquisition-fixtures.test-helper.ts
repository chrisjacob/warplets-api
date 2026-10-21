import { holderHistoryFixture } from "./holder-history-fixtures.test-helper";
import { trade,walletInput,key } from "./wallet-fixtures.test-helper";
import { WalletEvidenceSchema,type WalletEvidence } from "./wallet-analysis";
import { curveAddress } from "./pump";
import { hashJson,toBase58 } from "./solana";
import type { HolderHistoryInput } from "./holder-history-model";
import type { HolderAcquisitionInput } from "./holder-acquisition-model";
import type { WalletTransaction } from "./wallet-rpc";

export async function acquisitionTrade(side="buy",sig=71,slot=31010) {
  const tx=await trade(key(3),slot,side,sig);tx.blockTime=Date.parse("2026-10-21T08:35:00Z")/1000;
  const addresses=tx.transaction.message.accountKeys,system="11111111111111111111111111111111",mint=(await walletInput()).asset.address,curve=await curveAddress(mint);
  if(!addresses.includes(system)){addresses.push(system);tx.meta!.preBalances.push(10000);tx.meta!.postBalances.push(10000);}
  const data=new Uint8Array(12),view=new DataView(data.buffer);view.setUint32(0,2,true);view.setBigUint64(4,50n,true);
  tx.meta!.innerInstructions![0]!.instructions.push({programIdIndex:addresses.indexOf(system),accounts:side==="buy"?[addresses.indexOf(key(3)),addresses.indexOf(curve)]:[addresses.indexOf(curve),addresses.indexOf(key(3))],stackHeight:2,data:toBase58(data)});
  return tx;
}
export async function acquisitionWallet(transactions:WalletTransaction[]=[]) {
  const wallet=await walletInput();wallet.observed_at="2026-10-21T09:03:00.000Z";wallet.asset.creation=null;wallet.asset.graduation=null;
  wallet.records=transactions.map(tx=>({signature:tx.transaction.signatures[0]!,fetched_at:"2026-10-21T09:02:00.000Z",status:"available",purposes:["recent"],transaction:tx}));
  wallet.histories=[{address:wallet.asset.pool,purpose:"pool",fetched_at:"2026-10-21T09:01:00.000Z",rows:transactions.map(tx=>({signature:tx.transaction.signatures[0]!,slot:tx.slot,blockTime:tx.blockTime,err:null,confirmationStatus:"finalized"}))}];
  return WalletEvidenceSchema.parse(wallet);
}
export async function acquisitionInput(history:HolderHistoryInput,wallet:WalletEvidence|null):Promise<HolderAcquisitionInput>{
  const normalized=wallet?WalletEvidenceSchema.parse(wallet):null,hash=normalized?await hashJson(normalized):null;
  return{version:"holder-acquisition-input-v1",history,selection:"latest_wallet_receipt_before_cutoff",
    wallet_index:normalized?[{evidence_hash:hash!,address:normalized.asset.address,observed_at:normalized.observed_at,bytes:new TextEncoder().encode(JSON.stringify(wallet)).length}]:[],
    wallet:normalized?{evidence_hash:hash!,raw_hash:await hashJson(wallet),evidence:wallet}:null};
}
export async function holderAcquisitionFixture(){return acquisitionInput(await holderHistoryFixture(),await acquisitionWallet([await acquisitionTrade()]));}
