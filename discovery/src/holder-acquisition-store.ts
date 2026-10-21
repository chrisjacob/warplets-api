import { holderHistoryInputs } from "./holder-history-store";
import { AcquisitionWalletMetaSchema,HOLDER_ACQUISITION_LIMITS as L,type HolderAcquisitionInput } from "./holder-acquisition-model";
import { reviewHolderAcquisition,HolderAcquisitionError } from "./holder-acquisition";
import { hashJson } from "./solana";
import {Address} from "./model";
import type {HolderHistoryInput} from "./holder-history-model";
export async function holderAcquisitionInputs(db:D1Database,address:string,now=new Date(),savedHistory?:HolderHistoryInput){
  const history=savedHistory??await holderHistoryInputs(db,address,now);
  if(history.address!==Address.parse(address)||history.cutoff_at!==now.toISOString())throw new HolderAcquisitionError("holder_acquisition_history_identity");
  const rows=await db.prepare(`SELECT payload_hash AS evidence_hash,address,observed_at,length(CAST(payload AS BLOB)) AS bytes
    FROM tenx_wallet_evidence WHERE address=?1 AND observed_at>=?2 AND observed_at<=?3
    ORDER BY observed_at DESC,payload_hash DESC LIMIT 2`).bind(history.address,new Date(now.getTime()-86_400_000).toISOString(),history.cutoff_at).all();
  const index=rows.results.map(row=>AcquisitionWalletMetaSchema.parse(row));
  const inputs:HolderAcquisitionInput={version:"holder-acquisition-input-v1",history,selection:"latest_wallet_receipt_before_cutoff",wallet_index:index,wallet:null};
  if(index[0] && !(index[1] && Date.parse(index[0].observed_at)===Date.parse(index[1].observed_at))){
    if(index[0].bytes>L.wallet_bytes)throw new HolderAcquisitionError("holder_acquisition_byte_limit");
    const row=await db.prepare("SELECT payload FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2 AND observed_at=?3 AND length(CAST(payload AS BLOB))<=?4")
      .bind(index[0].evidence_hash,address,index[0].observed_at,L.wallet_bytes).first<{payload:string}>();
    if(!row)throw new HolderAcquisitionError("holder_acquisition_wallet_missing");
    const evidence:unknown=JSON.parse(row.payload);inputs.wallet={evidence_hash:index[0].evidence_hash,raw_hash:await hashJson(evidence),evidence};
  }
  return inputs;
}
export async function holderAcquisition(db:D1Database,address:string,now=new Date()){const inputs=await holderAcquisitionInputs(db,address,now);return{inputs,report:await reviewHolderAcquisition(inputs)};}
