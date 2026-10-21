import type {HolderReceipt,WalletReceipt} from "./evidence-read-store";

// These are prepared statements, not independently committed writes. Callers
// retain their original db.batch(), statement order and result positions.
export function d1EvidenceWriteStore(db:D1Database){
  return {
    holder(row:HolderReceipt):D1PreparedStatement{
      return db.prepare(`INSERT INTO tenx_holder_evidence(payload_hash,address,slot,payload,observed_at) VALUES(?1,?2,?3,?4,?5)
        ON CONFLICT(payload_hash) DO UPDATE SET payload=NULL
        WHERE tenx_holder_evidence.address IS NOT excluded.address
          OR tenx_holder_evidence.slot IS NOT excluded.slot
          OR tenx_holder_evidence.payload IS NOT excluded.payload`)
        .bind(row.payload_hash,row.address,row.slot,row.payload,row.observed_at);
    },
    wallet(row:WalletReceipt):D1PreparedStatement{
      return db.prepare(`INSERT INTO tenx_wallet_evidence(payload_hash,address,payload,observed_at) VALUES(?1,?2,?3,?4)
        ON CONFLICT(payload_hash) DO UPDATE SET payload=NULL
        WHERE tenx_wallet_evidence.address IS NOT excluded.address
          OR tenx_wallet_evidence.payload IS NOT excluded.payload
          OR tenx_wallet_evidence.observed_at IS NOT excluded.observed_at`)
        .bind(row.payload_hash,row.address,row.payload,row.observed_at);
    },
  };
}
// The existing payload NOT NULL constraint deliberately aborts a conflicting
// append, rolling back the surrounding batch. No prior row can be overwritten.
// Holder observed_at is outside the content hash: identical content observed
// again remains a no-op and retains the first receipt time, as before.
// Hash/schema/size certification stays with each original producer. This D1
// statement contract cannot pretend an external-object write is SQL-atomic.
