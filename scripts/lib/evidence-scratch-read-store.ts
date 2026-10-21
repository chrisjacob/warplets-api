// Offline Node adapter; never imported by application/Worker code.
import type {DatabaseSync} from "node:sqlite";
import {isDeepStrictEqual} from "node:util";
import type {EvidenceReadStore} from "../../discovery/src/evidence-read-store";
import {HolderArchiveMetaSchema} from "../../discovery/src/holder-history-model";
import {AcquisitionWalletMetaSchema} from "../../discovery/src/holder-acquisition-model";

type Reader={sqlite:DatabaseSync;describe(table:string,key:string):unknown;resolve(table:string,key:string):Promise<{payload:string}>};
export function scratchEvidenceReadStore(reader:Reader):EvidenceReadStore{
  function matching(table:string,key:string,meta:unknown,maximumBytes:number){
    if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0)throw Error("scratch_read_byte_bound_invalid");
    const found=table==="tenx_holder_evidence"?HolderArchiveMetaSchema.parse(reader.describe(table,key)):AcquisitionWalletMetaSchema.parse(reader.describe(table,key));
    return isDeepStrictEqual(found,meta)&&found.bytes<=maximumBytes;
  }
  return {
    async holderReceipt(hash,address){
      // Null means absent only from this fully admitted frozen metadata population.
      // Existing metadata must still resolve/authenticate; never catch corrupt objects.
      const row=address===undefined?reader.sqlite.prepare("SELECT payload_hash FROM tenx_holder_evidence WHERE payload_hash=?").get(hash)
        :reader.sqlite.prepare("SELECT payload_hash FROM tenx_holder_evidence WHERE payload_hash=? AND address=?").get(hash,address);
      if(!row)return null;const meta=HolderArchiveMetaSchema.parse(reader.describe("tenx_holder_evidence",hash)),saved=await reader.resolve("tenx_holder_evidence",hash);
      return {payload_hash:meta.payload_hash,address:meta.address,slot:meta.slot,payload:saved.payload,observed_at:meta.observed_at};
    },
    async walletReceipt(hash,address){
      const row=address===undefined?reader.sqlite.prepare("SELECT payload_hash FROM tenx_wallet_evidence WHERE payload_hash=?").get(hash)
        :reader.sqlite.prepare("SELECT payload_hash FROM tenx_wallet_evidence WHERE payload_hash=? AND address=?").get(hash,address);
      if(!row)return null;const meta=AcquisitionWalletMetaSchema.parse(reader.describe("tenx_wallet_evidence",hash)),saved=await reader.resolve("tenx_wallet_evidence",hash);
      return {payload_hash:meta.evidence_hash,address:meta.address,payload:saved.payload,observed_at:meta.observed_at};
    },
    async holderIndex(address,start,cutoff){
      const selected=reader.sqlite.prepare(`SELECT payload_hash FROM tenx_holder_evidence WHERE address=? AND observed_at>=? AND observed_at<=?
        ORDER BY observed_at,slot,payload_hash LIMIT 97`).all(address,start,cutoff);
      return selected.map(r=>HolderArchiveMetaSchema.parse(reader.describe("tenx_holder_evidence",String(r.payload_hash))));
    },
    async walletIndex(address,start,cutoff){
      const selected=reader.sqlite.prepare(`SELECT payload_hash FROM tenx_wallet_evidence WHERE address=? AND observed_at>=? AND observed_at<=?
        ORDER BY observed_at DESC,payload_hash DESC LIMIT 2`).all(address,start,cutoff);
      return selected.map(r=>AcquisitionWalletMetaSchema.parse(reader.describe("tenx_wallet_evidence",String(r.payload_hash))));
    },
    async holderPayload(meta,maximumBytes){
      const parsed=HolderArchiveMetaSchema.parse(meta);
      if(!matching("tenx_holder_evidence",parsed.payload_hash,parsed,maximumBytes))return null;
      return (await reader.resolve("tenx_holder_evidence",parsed.payload_hash)).payload;
    },
    async walletPayload(meta,maximumBytes){
      const parsed=AcquisitionWalletMetaSchema.parse(meta);
      if(!matching("tenx_wallet_evidence",parsed.evidence_hash,parsed,maximumBytes))return null;
      return (await reader.resolve("tenx_wallet_evidence",parsed.evidence_hash)).payload;
    },
  };
}
