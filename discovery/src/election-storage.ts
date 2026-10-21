import { z } from "zod";
import { ElectionInputSchema } from "./election-model";
import { ElectionError } from "./election-error";
import { hashJson } from "./solana";

export const ELECTION_INLINE_BYTES=1_600_000;
export const ELECTION_INPUT_BYTES=4_000_000;
export const ELECTION_CHUNK_BYTES=512_000;
export const ELECTION_CHUNKS=8;
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ElectionStorageManifest=z.object({
  version:z.literal("election-chunks-v1"),input_hash:Hash,input_bytes:z.number().int().min(1).max(ELECTION_INPUT_BYTES),
  chunks:z.array(z.object({ordinal:z.number().int().min(0).max(ELECTION_CHUNKS-1),bytes:z.number().int().min(1).max(ELECTION_CHUNK_BYTES),payload_hash:Hash}).strict()).min(1).max(ELECTION_CHUNKS),
}).strict();
type Chunk={ordinal:number;bytes:number;payload_hash:string;payload:string};

export async function encodeElectionStorage(text:string,inputHash:string,forceChunks=false):Promise<{stored:string;chunks:Chunk[]}>{
  const bytes=new TextEncoder().encode(text);
  if(bytes.length>ELECTION_INPUT_BYTES)throw new ElectionError("election_snapshot_size_limit");
  if(bytes.length<=ELECTION_INLINE_BYTES&&!forceChunks)return {stored:text,chunks:[]};
  const chunks:Chunk[]=[],decoder=new TextDecoder("utf-8",{fatal:true});
  for(let start=0;start<bytes.length;){
    let end=Math.min(start+ELECTION_CHUNK_BYTES,bytes.length);
    // Keep UTF-8 code points whole across D1 TEXT values, including emoji.
    while(end<bytes.length&&(bytes[end]!&0xc0)===0x80)end--;
    const payload=decoder.decode(bytes.subarray(start,end));
    chunks.push({ordinal:chunks.length,bytes:end-start,payload_hash:await hashJson(payload),payload});start=end;
  }
  const manifest=ElectionStorageManifest.parse({version:"election-chunks-v1",input_hash:inputHash,input_bytes:bytes.length,chunks:chunks.map(({ordinal,bytes,payload_hash})=>({ordinal,bytes,payload_hash}))});
  return {stored:JSON.stringify(manifest),chunks};
}

export async function readElectionStorage(db:D1Database,id:string,stored:string,inputHash:string){
  if(new TextEncoder().encode(stored).length>ELECTION_INLINE_BYTES)throw new ElectionError("election_snapshot_size_limit");
  const raw=JSON.parse(stored);
  // Old sealed records remain inline and use the unchanged v1 input/engine.
  if(raw?.version==="election-input-v1")return ElectionInputSchema.parse(raw);
  const parsed=ElectionStorageManifest.safeParse(raw);
  if(!parsed.success)throw new ElectionError("election_chunk_manifest_invalid");
  const manifest=parsed.data;
  if(manifest.input_hash!==inputHash||manifest.chunks.some((c,i)=>c.ordinal!==i)||manifest.chunks.reduce((n,c)=>n+c.bytes,0)!==manifest.input_bytes)throw new ElectionError("election_chunk_manifest_mismatch");
  // Bound corrupt storage before materializing its strings. Never trim extras.
  const rows=await db.prepare(`SELECT ordinal,payload_bytes,payload_hash,
    CASE WHEN COUNT(*) OVER()>?2 OR SUM(length(CAST(payload AS BLOB))) OVER()>?3 OR MAX(length(CAST(payload AS BLOB))) OVER()>?4 THEN NULL ELSE payload END AS payload
    FROM tenx_election_chunks WHERE run_id=?1 ORDER BY ordinal LIMIT 9`)
    .bind(id,ELECTION_CHUNKS,ELECTION_INPUT_BYTES,ELECTION_CHUNK_BYTES).all<{ordinal:number;payload_bytes:number;payload_hash:string;payload:string|null}>();
  if(rows.results.length!==manifest.chunks.length)throw new ElectionError("election_chunk_count_mismatch");
  const texts:string[]=[];
  for(const [i,row] of rows.results.entries()){
    const expected=manifest.chunks[i]!;
    if(row.payload===null||row.ordinal!==i||row.payload_bytes!==expected.bytes||row.payload_hash!==expected.payload_hash||new TextEncoder().encode(row.payload).length!==expected.bytes||await hashJson(row.payload)!==expected.payload_hash)throw new ElectionError("election_chunk_hash_mismatch");
    texts.push(row.payload);
  }
  const text=texts.join("");
  if(new TextEncoder().encode(text).length!==manifest.input_bytes)throw new ElectionError("election_chunk_manifest_mismatch");
  return ElectionInputSchema.parse(JSON.parse(text));
}
