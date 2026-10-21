// Synthetic-only local runtime fixture; never an application route.
import {boundedJson,JSON_STREAM_LIMITS as L} from "../discovery/src/rpc";
export default {async fetch(request:Request){
  const kind=new URL(request.url).pathname.slice(1);let reads=0,cancellations=0;
  const text=kind==="normal"?'\ufeff{"text":"漢😀","zero":0,"flag":false}':kind==="oversized"?"x".repeat(32001):'"'+"x".repeat(L.chunks)+'"',bytes=new TextEncoder().encode(text);
  const body=new ReadableStream<Uint8Array>({pull(c){
    if(kind==="stalled")return new Promise<void>(()=>{});
    if(kind==="empty_fragments"){reads++;c.enqueue(new Uint8Array());return;}
    if(reads>=bytes.length){c.close();return;}const width=kind==="oversized"?bytes.length:1;c.enqueue(bytes.subarray(reads,reads+width));reads+=width;
  },cancel(){cancellations++;if(kind==="empty_fragments"||kind==="stalled")return new Promise<void>(()=>{});}},{highWaterMark:0});
  let state="parsed",error:string|null=null,value:unknown=null;
  try{value=await boundedJson(new Response(body),32000);}catch(e){state="held";error=e instanceof Error?e.message:"unknown";}
  return Response.json({kind,state,error,value,reads,cancellations,stream_unlocked:!body.locked});
}};
