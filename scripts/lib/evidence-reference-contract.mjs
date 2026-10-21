// Shared private tooling contract. No filesystem, provider IO or action authority.
import {createHash,createDecipheriv} from "node:crypto";
import {Buffer} from "node:buffer";
import {gunzipSync} from "node:zlib";
import {z} from "zod";

const Hash=z.string().length(64).regex(/^[a-f0-9]{64}$/),Text=z.string().max(4096),Identity=Text.min(1);
export const EvidenceCipherDescriptor=z.object({sha256:Hash,bytes:z.number().int().positive().max(2100000),iv:z.string().length(24).regex(/^[a-f0-9]{24}$/),tag:z.string().length(32).regex(/^[a-f0-9]{32}$/)}).strict();
export const EvidenceObject=z.object({sha256:Hash,bytes:z.number().int().nonnegative().max(2000000),gzip_bytes:z.number().int().positive().max(2100000),gzip_sha256:Hash}).strict();
export const EvidenceEntry=z.discriminatedUnion("table",[
  z.object({table:z.literal("tenx_holder_evidence"),metadata:z.tuple([Identity,Text,z.number().int().safe(),Text]),object_sha256:Hash,row_sha256:Hash}).strict(),
  z.object({table:z.literal("tenx_wallet_evidence"),metadata:z.tuple([Identity,Text,Text]),object_sha256:Hash,row_sha256:Hash}).strict(),
]);
export const evidenceHash=bytes=>createHash("sha256").update(bytes).digest("hex");
export function canonicalEvidenceReference(reference){
  z.object({entry:EvidenceEntry,object:EvidenceObject,sealed:EvidenceCipherDescriptor}).strict().parse(reference);
  const {entry,object,sealed}=reference;
  if(object.gzip_bytes!==sealed.bytes||entry.object_sha256!==object.sha256)throw Error("Evidence reference object mismatch");
  return {entry:{table:entry.table,metadata:entry.metadata,object_sha256:entry.object_sha256,row_sha256:entry.row_sha256},
    object:{sha256:object.sha256,bytes:object.bytes,gzip_bytes:object.gzip_bytes,gzip_sha256:object.gzip_sha256},
    sealed:{sha256:sealed.sha256,bytes:sealed.bytes,iv:sealed.iv,tag:sealed.tag}};
}
export function recoverEvidenceBytes(reference,ciphertext,key){
  const {entry,object,sealed}=canonicalEvidenceReference(reference);
  if(key.length!==32||ciphertext.length!==sealed.bytes||evidenceHash(ciphertext)!==sealed.sha256)throw Error("Evidence ciphertext checksum/size mismatch");
  const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(sealed.iv,"hex"),{authTagLength:16});
  decipher.setAAD(Buffer.from("discovery-evidence-sealed-v1|object|"+object.sha256));decipher.setAuthTag(Buffer.from(sealed.tag,"hex"));
  const compressed=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
  if(compressed.length!==object.gzip_bytes||evidenceHash(compressed)!==object.gzip_sha256)throw Error("Evidence gzip checksum/size mismatch");
  const raw=gunzipSync(compressed,{maxOutputLength:Math.max(1,object.bytes)});
  if(raw.length!==object.bytes||evidenceHash(raw)!==object.sha256)throw Error("Evidence raw checksum/size mismatch");
  const payload=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw),m=entry.metadata;
  const row=entry.table==="tenx_holder_evidence"?{payload_hash:m[0],address:m[1],slot:m[2],payload,observed_at:m[3]}:{payload_hash:m[0],address:m[1],payload,observed_at:m[2]};
  if(evidenceHash(JSON.stringify(row))!==entry.row_sha256)throw Error("Evidence original row checksum mismatch");
  return row;
}
