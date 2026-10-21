import type { z } from "zod";
import { HolderArchiveMetaSchema } from "./holder-history-model";
import { AcquisitionWalletMetaSchema } from "./holder-acquisition-model";

export type HolderReceiptMeta = z.infer<typeof HolderArchiveMetaSchema>;
export type WalletReceiptMeta = z.infer<typeof AcquisitionWalletMetaSchema>;
// Explicit bounded reads, not a generic SQL proxy or a writable storage binding.
export interface EvidenceReadStore {
  holderIndex(address:string,start:string,cutoff:string):Promise<HolderReceiptMeta[]>;
  walletIndex(address:string,start:string,cutoff:string):Promise<WalletReceiptMeta[]>;
  holderPayload(meta:HolderReceiptMeta,maximumBytes:number):Promise<string|null>;
  walletPayload(meta:WalletReceiptMeta,maximumBytes:number):Promise<string|null>;
}

export function d1EvidenceReadStore(db:D1Database):EvidenceReadStore {
  return {
    async holderIndex(address,start,cutoff){
      const rows=await db.prepare(`SELECT payload_hash,address,slot,observed_at,length(CAST(payload AS BLOB)) AS bytes
        FROM tenx_holder_evidence WHERE address=?1 AND observed_at>=?2 AND observed_at<=?3
        ORDER BY observed_at,slot,payload_hash LIMIT 97`).bind(address,start,cutoff).all();
      return rows.results.map(row=>HolderArchiveMetaSchema.parse(row));
    },
    async walletIndex(address,start,cutoff){
      const rows=await db.prepare(`SELECT payload_hash AS evidence_hash,address,observed_at,length(CAST(payload AS BLOB)) AS bytes
        FROM tenx_wallet_evidence WHERE address=?1 AND observed_at>=?2 AND observed_at<=?3
        ORDER BY observed_at DESC,payload_hash DESC LIMIT 2`).bind(address,start,cutoff).all();
      return rows.results.map(row=>AcquisitionWalletMetaSchema.parse(row));
    },
    async holderPayload(meta,maximumBytes){
      const row=await db.prepare("SELECT payload FROM tenx_holder_evidence WHERE payload_hash=?1 AND address=?2 AND slot=?3 AND observed_at=?4 AND length(CAST(payload AS BLOB))<=?5")
        .bind(meta.payload_hash,meta.address,meta.slot,meta.observed_at,maximumBytes).first<{payload:string}>();
      return row?.payload??null;
    },
    async walletPayload(meta,maximumBytes){
      const row=await db.prepare("SELECT payload FROM tenx_wallet_evidence WHERE payload_hash=?1 AND address=?2 AND observed_at=?3 AND length(CAST(payload AS BLOB))<=?4")
        .bind(meta.evidence_hash,meta.address,meta.observed_at,maximumBytes).first<{payload:string}>();
      return row?.payload??null;
    },
  };
}
