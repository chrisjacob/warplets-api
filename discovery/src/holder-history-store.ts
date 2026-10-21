import { Address } from "./model";
import { HOLDER_HISTORY_LIMITS as L, HolderArchiveMetaSchema, type HolderHistoryInput } from "./holder-history-model";
import { HolderHistoryError, reviewHolderHistory, selectedHolderSnapshots } from "./holder-history";

// Read-only work over existing immutable inventory receipts. No new scan,
// journal, score capture, retention policy or provider-budget allocation.
export async function holderHistoryInputs(db: D1Database, rawAddress: string, now = new Date()) {
  const address = Address.parse(rawAddress), cutoff_at = now.toISOString(), start = new Date(now.getTime()-86_400_000).toISOString();
  const rows = await db.prepare(`SELECT payload_hash,address,slot,observed_at,length(CAST(payload AS BLOB)) AS bytes
    FROM tenx_holder_evidence WHERE address=?1 AND observed_at>=?2 AND observed_at<=?3
    ORDER BY observed_at,slot,payload_hash LIMIT 97`).bind(address,start,cutoff_at).all();
  const index = rows.results.map(row=>HolderArchiveMetaSchema.parse(row)), selected = selectedHolderSnapshots(index);
  const inputs: HolderHistoryInput = { version: "holder-history-input-v1", address, cutoff_at, selection: "first_and_latest_two_within_24h", index, samples: [] };
  for (const meta of selected) {
    if (meta.bytes > L.snapshot_bytes) throw new HolderHistoryError("holder_history_byte_limit");
    const row = await db.prepare("SELECT payload FROM tenx_holder_evidence WHERE payload_hash=?1 AND address=?2 AND slot=?3 AND observed_at=?4 AND length(CAST(payload AS BLOB))<=?5")
      .bind(meta.payload_hash,address,meta.slot,meta.observed_at,L.snapshot_bytes).first<{payload:string}>();
    if (!row) throw new HolderHistoryError("holder_history_evidence_missing");
    inputs.samples.push({payload_hash:meta.payload_hash,evidence:JSON.parse(row.payload)});
  }
  return inputs;
}
export async function holderHistory(db:D1Database,address:string,now=new Date()){
  const inputs=await holderHistoryInputs(db,address,now);return{inputs,report:await reviewHolderHistory(inputs)};
}
