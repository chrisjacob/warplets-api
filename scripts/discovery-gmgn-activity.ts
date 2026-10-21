import{lstatSync,mkdirSync,readFileSync,writeFileSync}from"node:fs";
import{randomUUID}from"node:crypto";
import{fileURLToPath}from"node:url";
import{GMGN_ACTIVITY_REPLAY_BYTES,replayGmgnActivityRecord}from"../discovery/src/gmgn-activity-replay";
try{
  const[command,value,...extra]=process.argv.slice(2);if(extra.length||!value)throw Error("usage");
  let raw:unknown;
  if(command==="replay"){
    const stat=lstatSync(value);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>GMGN_ACTIVITY_REPLAY_BYTES)throw Error("bound");raw=JSON.parse(readFileSync(value,"utf8"));
  }else if(command==="freeze"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)){
    const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];if(!token)throw Error("config");
    const response=await fetch(`http://127.0.0.1:8794/api/10x/admin/gmgn/reviews/${value}`,{headers:{authorization:`Bearer ${token}`},redirect:"manual",signal:AbortSignal.timeout(30_000)});
    if(!response.ok||!response.body)throw Error("cache");const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
    try{while(true){const next=await reader.read();if(next.done)break;count+=next.value.byteLength;if(count>GMGN_ACTIVITY_REPLAY_BYTES)throw Error("bound");parts.push(next.value);}}finally{await reader.cancel();reader.releaseLock();}
    const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    raw=JSON.parse(new TextDecoder().decode(bytes)).activity_replay;
  }else throw Error("usage");
  const report=await replayGmgnActivityRecord(raw);
  let artifact:string|undefined;
  if(command==="freeze"){
    const dir=new URL("../.tmp/",import.meta.url);mkdirSync(dir,{recursive:true});const target=new URL(`gmgn-activity-${value}-${randomUUID()}.json`,dir);
    writeFileSync(target,JSON.stringify(raw),{flag:"wx",mode:0o600});artifact=fileURLToPath(target);
  }
  console.log(JSON.stringify({artifact,replay:"verified",report_hash:report.report_hash,receipt_hash:report.receipt_hash,provider_requests:0,database_writes:0}));
}catch{console.error("GMGN wallet activity evidence failed; use freeze UUID | replay FILE. Check the local cache or artifact. No credentials printed.");process.exitCode=1;}
