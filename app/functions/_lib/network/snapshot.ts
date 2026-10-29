import type { NetworkCell, NetworkSnapshot } from '../../../shared/network/model';

// Keep metadata as ordinary JSON for history/chain reconciliation SQL. Only
// the aggregate cells are compressed; public APIs still return normal JSON.
export const SNAPSHOT_STORAGE_BYTES = 1_800_000;
const CELL_BYTES = 16_000_000;
type Envelope = Omit<NetworkSnapshot,'cells'> & { cells?:NetworkCell[]; cellsEncoding?:string; cellsGzip?:string };

async function boundedBytes(stream:ReadableStream<Uint8Array>,limit:number):Promise<Uint8Array> {
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;
      if(size>limit){await reader.cancel();throw Error('Snapshot cell data exceeds decode budget');}
      chunks.push(next.value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}
function base64(bytes:Uint8Array):string {
  const parts:string[]=[];
  for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
  return btoa(parts.join(''));
}
export async function encodeNetworkSnapshot(snapshot:NetworkSnapshot):Promise<string> {
  const {cells,...metadata}=snapshot;
  const raw=JSON.stringify(cells);
  if(new TextEncoder().encode(raw).byteLength>CELL_BYTES)throw Error('Snapshot cell data exceeds decode budget');
  const compressed=await boundedBytes(new Response(raw).body!.pipeThrough(new CompressionStream('gzip')),SNAPSHOT_STORAGE_BYTES);
  const payload=JSON.stringify({...metadata,cellsEncoding:'gzip-json-v1',cellsGzip:base64(compressed)});
  if(new TextEncoder().encode(payload).byteLength>SNAPSHOT_STORAGE_BYTES)throw Error('Snapshot exceeds storage budget');
  return payload;
}
export async function decodeNetworkSnapshot(payload:string):Promise<NetworkSnapshot> {
  const {cellsEncoding,cellsGzip,...metadata}=JSON.parse(payload) as Envelope;
  if(cellsEncoding===undefined){
    if(!Array.isArray(metadata.cells))throw Error('Invalid legacy snapshot cells');
    return {...metadata,cells:metadata.cells};
  }
  if(cellsEncoding!=='gzip-json-v1'||typeof cellsGzip!=='string'||cellsGzip.length>SNAPSHOT_STORAGE_BYTES)throw Error('Unsupported snapshot encoding');
  const compressed=Uint8Array.from(atob(cellsGzip),character=>character.charCodeAt(0));
  const bytes=await boundedBytes(new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip')),CELL_BYTES);
  const cells=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as NetworkCell[];
  if(!Array.isArray(cells)||cells.reduce((total,cell)=>total+cell.count,0)!==metadata.population)throw Error('Snapshot cell reconciliation failed');
  return {...metadata,cells};
}
