import { Address } from "./model";
import { HOLDER_HISTORY_LIMITS as L, HolderArchiveMetaSchema, type HolderHistoryInput } from "./holder-history-model";
import { HolderHistoryError, reviewHolderHistory, selectedHolderSnapshots } from "./holder-history";
import { d1EvidenceReadStore,type EvidenceReadStore } from "./evidence-read-store";

// Read-only work over existing immutable inventory receipts. No new scan,
// journal, score capture, retention policy or provider-budget allocation.
export async function holderHistoryInputs(db: D1Database, rawAddress: string, now = new Date()) {
  return holderHistoryInputsFromStore(d1EvidenceReadStore(db),rawAddress,now);
}
export async function holderHistoryInputsFromStore(store:EvidenceReadStore,rawAddress:string,now=new Date()){
  const address = Address.parse(rawAddress), cutoff_at = now.toISOString(), start = new Date(now.getTime()-86_400_000).toISOString();
  const index = (await store.holderIndex(address,start,cutoff_at)).map(row=>HolderArchiveMetaSchema.parse(row)), selected = selectedHolderSnapshots(index);
  if(index.some(meta=>meta.address!==address))throw new HolderHistoryError("holder_history_index_mismatch");
  const inputs: HolderHistoryInput = { version: "holder-history-input-v1", address, cutoff_at, selection: "first_and_latest_two_within_24h", index, samples: [] };
  for (const meta of selected) {
    if (meta.bytes > L.snapshot_bytes) throw new HolderHistoryError("holder_history_byte_limit");
    const payload=await store.holderPayload(meta,L.snapshot_bytes);
    if (payload===null) throw new HolderHistoryError("holder_history_evidence_missing");
    inputs.samples.push({payload_hash:meta.payload_hash,evidence:JSON.parse(payload)});
  }
  return inputs;
}
export async function holderHistory(db:D1Database,address:string,now=new Date()){
  const inputs=await holderHistoryInputs(db,address,now);return{inputs,report:await reviewHolderHistory(inputs)};
}
