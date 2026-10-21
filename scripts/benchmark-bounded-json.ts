// Synthetic local wall measurements; never Worker CPU or production acceptance.
import {mkdir,realpath,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {boundedJson,SourceError} from "../discovery/src/rpc";
import {evidencePrivatePath} from "./discovery-evidence-objects.mjs";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
// Exact pre-hardening reader algorithm, retained only as an offline comparator.
async function legacy(response:Response,limit:number):Promise<unknown>{
  if(!response.body)throw new SourceError("empty_response");const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.byteLength;if(length>limit)throw new SourceError("response_too_large");chunks.push(chunk.value);}}
  catch(error){await reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new SourceError("invalid_json");}
}
const target=process.argv[2];if(!target)throw Error("Supply NEW private .tmp output");const output=await evidencePrivatePath(target,true);
if(path.dirname(output)!==await realpath(".tmp"))throw Error("Standalone private .tmp output required");await mkdir(output,{mode:0o700});
const summary=(xs:number[])=>{const a=[...xs].sort((a,b)=>a-b);return{n:a.length,median_ms:a[Math.floor(a.length/2)],p95_ms:a[Math.ceil(a.length*.95)-1]};},measurements=[];
for(const [name,length,width,shouldHold] of [["ordinary_metadata",32000,4096,false],["large_rpc",1800000,65536,false],["fragment_flood",131072,1,true]] as const){
  const text=JSON.stringify({text:"x".repeat(length),unicode:"漢😀",zero:0,flag:false}),bytes=new TextEncoder().encode(text),expected=sha(text),versions=[];
  for(const [version,read] of [["legacy",legacy],["bounded",boundedJson]] as const){
    const times:number[]=[],reads:number[]=[];let outcome="parsed";
    for(let n=0;n<12;n++){
      let offset=0,pulls=0;const stream=new ReadableStream<Uint8Array>({pull(c){pulls++;if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.subarray(offset,offset+width));offset+=width;}},{highWaterMark:0}),start=performance.now();
      try{const result=await read(new Response(stream),3000000);if(sha(JSON.stringify(result))!==expected)throw Error("Value parity failed");if(version==="bounded"&&shouldHold)throw Error("Fragment flood was not held");}
      catch(e){if(!(version==="bounded"&&shouldHold&&e instanceof SourceError&&e.code==="response_fragment_limit"))throw e;outcome="held_fragment_limit";}
      if(n>=2){times.push(performance.now()-start);reads.push(pulls);}
    }
    versions.push({version,outcome,...summary(times),min_reads:Math.min(...reads),max_reads:Math.max(...reads)});
  }measurements.push({name,raw_bytes:bytes.length,fragment_bytes:width,versions});
}
const report={version:"bounded-json-comparison-v1",baseline:"pre-123 algorithm",node:process.version,scope:"synthetic Node wall time including Response construction, read, parse and result hash; excludes stream construction; not Worker billed CPU",measurements,network_requests:0,provider_limits_changed:false,evidence_gates_changed:false,cpu_acceptance:false};
const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(output,"benchmark.json"),bytes,{flag:"wx",mode:0o600});console.log(JSON.stringify({...report,report_file_sha256:sha(bytes)},null,2));
