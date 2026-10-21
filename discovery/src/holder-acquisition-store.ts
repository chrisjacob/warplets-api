import { holderHistoryInputsFromStore } from "./holder-history-store";
import { AcquisitionWalletMetaSchema,HOLDER_ACQUISITION_LIMITS as L,type HolderAcquisitionInput } from "./holder-acquisition-model";
import { reviewHolderAcquisition,HolderAcquisitionError } from "./holder-acquisition";
import { hashJson } from "./solana";
import {Address} from "./model";
import type {HolderHistoryInput} from "./holder-history-model";
import {d1EvidenceReadStore,type EvidenceReadStore} from "./evidence-read-store";
export async function holderAcquisitionInputs(db:D1Database,address:string,now=new Date(),savedHistory?:HolderHistoryInput){
  return holderAcquisitionInputsFromStore(d1EvidenceReadStore(db),address,now,savedHistory);
}
export async function holderAcquisitionInputsFromStore(store:EvidenceReadStore,address:string,now=new Date(),savedHistory?:HolderHistoryInput){
  const history=savedHistory??await holderHistoryInputsFromStore(store,address,now);
  if(history.address!==Address.parse(address)||history.cutoff_at!==now.toISOString())throw new HolderAcquisitionError("holder_acquisition_history_identity");
  const index=(await store.walletIndex(history.address,new Date(now.getTime()-86_400_000).toISOString(),history.cutoff_at)).map(row=>AcquisitionWalletMetaSchema.parse(row));
  if(index.some(meta=>meta.address!==history.address))throw new HolderAcquisitionError("holder_acquisition_wallet_identity");
  const inputs:HolderAcquisitionInput={version:"holder-acquisition-input-v1",history,selection:"latest_wallet_receipt_before_cutoff",wallet_index:index,wallet:null};
  if(index[0] && !(index[1] && Date.parse(index[0].observed_at)===Date.parse(index[1].observed_at))){
    if(index[0].bytes>L.wallet_bytes)throw new HolderAcquisitionError("holder_acquisition_byte_limit");
    const payload=await store.walletPayload(index[0],L.wallet_bytes);
    if(payload===null)throw new HolderAcquisitionError("holder_acquisition_wallet_missing");
    const evidence:unknown=JSON.parse(payload);inputs.wallet={evidence_hash:index[0].evidence_hash,raw_hash:await hashJson(evidence),evidence};
  }
  return inputs;
}
export async function holderAcquisition(db:D1Database,address:string,now=new Date()){const inputs=await holderAcquisitionInputs(db,address,now);return{inputs,report:await reviewHolderAcquisition(inputs)};}
