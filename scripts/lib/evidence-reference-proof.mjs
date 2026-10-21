// Shared offline/workerd proof contract. No filesystem, storage or authority.
import {createHash} from "node:crypto";
import {Buffer} from "node:buffer";
import {z} from "zod";
import {EvidenceEntry,EvidenceObject,EvidenceCipherDescriptor,canonicalEvidenceReference} from "./evidence-reference-contract.mjs";
const VERSION="discovery-evidence-references-v1",ALGORITHM="sha256-domain-separated-duplicate-last-v1",DB="references.sqlite";
const MAX_DB=64*1024**2,MAX_REFERENCE=128*1024,MAX_PROOF=1024;
const sha=bytes=>createHash("sha256").update(bytes).digest("hex"),digest=value=>sha(JSON.stringify(value));
const Hash=z.string().length(64).regex(/^[a-f0-9]{64}$/),Count=z.number().int().nonnegative().max(10000);
const Context=z.object({version:z.literal(VERSION),source_index_manifest_sha256:Hash,source_sealed_manifest_sha256:Hash,
  source_catalog_manifest_sha256:Hash,source_archive_manifest_sha256:Hash,rows:Count,objects:Count}).strict();
const Body=z.object({context:Context,confidentiality:z.literal("private_plaintext_metadata"),algorithm:z.literal(ALGORITHM),root_sha256:Hash,
  database:z.object({file:z.literal(DB),bytes:z.number().int().positive().max(MAX_DB),sha256:Hash}).strict()}).strict();
const Reference=z.object({ordinal:Count,entry:EvidenceEntry,object:EvidenceObject,sealed:EvidenceCipherDescriptor}).strict();
const Proof=Hash.array().max(14);
function canonicalContext(value){
  Context.parse(value);if(value.objects>value.rows||(value.rows>0&&value.objects===0))throw Error("Invalid reference context counts");
  return {version:value.version,source_index_manifest_sha256:value.source_index_manifest_sha256,source_sealed_manifest_sha256:value.source_sealed_manifest_sha256,
    source_catalog_manifest_sha256:value.source_catalog_manifest_sha256,source_archive_manifest_sha256:value.source_archive_manifest_sha256,rows:value.rows,objects:value.objects};
}
function canonicalLeaf(reference){
  Reference.parse(reference);const {ordinal,...rest}=reference,value={ordinal,...canonicalEvidenceReference(rest)};
  if(Buffer.byteLength(JSON.stringify(value))>MAX_REFERENCE)throw Error("Evidence reference exceeds byte bound");return value;
}
const contextHash=context=>Buffer.from(digest(canonicalContext(context)),"hex");
const leafHash=(context,leaf)=>sha(Buffer.concat([Buffer.from([0]),contextHash(context),Buffer.from(JSON.stringify(canonicalLeaf(leaf)))]));
const parentHash=(left,right)=>sha(Buffer.concat([Buffer.from([1]),Buffer.from(left,"hex"),Buffer.from(right,"hex")]));
const emptyHash=context=>sha(Buffer.concat([Buffer.from([2]),contextHash(context)]));

export function createReferenceTree(context,references){
  canonicalContext(context);if(references.length!==context.rows)throw Error("Reference count mismatch");
  const layers=[references.map((value,i)=>{if(value.ordinal!==i)throw Error("Noncontiguous reference order");return leafHash(context,value);})];
  while(layers.at(-1).length>1){const previous=layers.at(-1),next=[];for(let i=0;i<previous.length;i+=2)next.push(parentHash(previous[i],previous[i+1]??previous[i]));layers.push(next);}
  const proofs=references.map((_,i)=>{const proof=[];let index=i;for(let level=0;level<layers.length-1;level++){const layer=layers[level];proof.push(layer[index^1]??layer[index]);index=Math.floor(index/2);}return proof;});
  return {root_sha256:layers.at(-1)[0]??emptyHash(context),proofs};
}
function admittedManifest(manifest,pin){
  const {reference_manifest_sha256,...body}=manifest??{};
  if(!/^[a-f0-9]{64}$/.test(pin??"")||reference_manifest_sha256!==pin||digest(body)!==pin)throw Error("Reference manifest checksum mismatch");
  Body.parse(body);canonicalContext(body.context);
  if(body.context.rows===0&&body.root_sha256!==emptyHash(body.context))throw Error("Invalid empty reference tree");return manifest;
}
export function verifyReferenceProof(manifest,pin,reference,proof,table,identity){
  admittedManifest(manifest,pin);Proof.parse(proof);
  if(Buffer.byteLength(JSON.stringify(proof))>MAX_PROOF)throw Error("Reference proof exceeds byte bound");
  const value=canonicalLeaf(reference),count=manifest.context.rows;
  if(value.ordinal>=count||value.entry.table!==table||value.entry.metadata[0]!==identity||proof.length!==(count>1?Math.ceil(Math.log2(count)):0))throw Error("Reference identity/order/proof length mismatch");
  let hash=leafHash(manifest.context,value),index=value.ordinal,width=count;
  for(const sibling of proof){
    if(width%2===1&&index===width-1&&sibling!==hash)throw Error("Invalid odd reference sibling");
    hash=index%2===0?parentHash(hash,sibling):parentHash(sibling,hash);index=Math.floor(index/2);width=Math.ceil(width/2);
  }
  if(hash!==manifest.root_sha256)throw Error("Evidence reference root mismatch");return value;
}

export {admittedManifest,canonicalContext,canonicalLeaf,MAX_REFERENCE,MAX_PROOF};
