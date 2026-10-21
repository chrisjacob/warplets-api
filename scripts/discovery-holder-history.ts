import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Address } from "../discovery/src/model";
import { HOLDER_HISTORY_LIMITS, HolderHistoryReportSchema } from "../discovery/src/holder-history-model";
import { replayHolderHistoryRecord } from "../discovery/src/holder-history";

// Fixed loopback cache reads only. Replay never loads credentials or fetches.
try {
  const [command,value,...extra]=process.argv.slice(2);
  if(extra.length)throw Error("usage");
  if(command==="replay"&&value){
    const stat=lstatSync(value);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>HOLDER_HISTORY_LIMITS.input_bytes+100_000)throw Error("file_bound");
    const report=await replayHolderHistoryRecord(JSON.parse(readFileSync(value,"utf8")));
    console.log(JSON.stringify({replay:"verified",report_hash:report.report_hash,provider_requests:0,database_writes:0}));
  }else if((command==="read"||command==="freeze")&&value){
    const address=Address.parse(value),headers:Record<string,string>={};
    if(command==="freeze"){
      const vars=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8"),token=vars.match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];
      if(!token)throw Error("configuration");headers.authorization="Bearer "+token;
    }
    const response=await fetch(`http://127.0.0.1:8794/api/10x/${command==="freeze"?"admin/":""}holders/history/solana/${address}`,{headers,redirect:"manual",signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error("local_cache_unavailable");
    // Server-side archive bounds apply too; bound the operator's received body.
    const reader=response.body!.getReader(),parts:Uint8Array[]=[];let bytes=0;
    try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>HOLDER_HISTORY_LIMITS.input_bytes+100_000)throw Error("response_bound");parts.push(next.value);}}
    finally{await reader.cancel();reader.releaseLock();}
    const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
    const raw=JSON.parse(new TextDecoder().decode(all));
    if(command==="read")console.log(JSON.stringify(HolderHistoryReportSchema.parse(raw),null,2));
    else{
      const report=await replayHolderHistoryRecord(raw),directory=new URL("../.tmp/",import.meta.url);mkdirSync(directory,{recursive:true});
      const target=new URL(`holder-history-${address}-${randomUUID()}.json`,directory);
      writeFileSync(target,JSON.stringify(raw),{flag:"wx",mode:0o600});
      console.log(JSON.stringify({artifact:fileURLToPath(target),report_hash:report.report_hash,replay:"verified",provider_requests:0,database_writes:0}));
    }
  }else throw Error("usage");
}catch{
  console.error("Holder history operation failed; use read MINT | freeze MINT | replay FILE and check the local cache. No credentials printed.");process.exitCode=1;
}
