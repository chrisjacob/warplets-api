import{lstatSync,mkdirSync,readFileSync,writeFileSync}from"node:fs";
import{randomUUID}from"node:crypto";import{fileURLToPath}from"node:url";
import{GMGN_CORROBORATION_BYTES,GmgnCorroborationReportSchema,replayGmgnCorroboration}from"../discovery/src/gmgn-corroboration";
try{
 const[command,value,...extra]=process.argv.slice(2);if(extra.length||!value)throw Error("usage");
 if(command==="replay"){
  const stat=lstatSync(value);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>GMGN_CORROBORATION_BYTES+100_000)throw Error("bound");
  const report=await replayGmgnCorroboration(JSON.parse(readFileSync(value,"utf8")));console.log(JSON.stringify({replay:"verified",report_hash:report.report_hash,provider_requests:0,database_writes:0}));
 }else if(["read","freeze","collect"].includes(command!)&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)){
  const headers:Record<string,string>={};if(command!=="read"){const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];if(!token)throw Error("config");headers.authorization=`Bearer ${token}`;}
  if(command==="collect")headers["content-type"]="application/json";
  const url=command==="collect"?"admin/gmgn/corroboration/collect":`${command==="freeze"?"admin/":""}gmgn/corroboration/${value}`;
  const response=await fetch(`http://127.0.0.1:8794/api/10x/${url}`,{method:command==="collect"?"POST":"GET",headers,...(command==="collect"?{body:JSON.stringify({activity_id:value,reason:"Explicit bounded RPC corroboration of saved GMGN activity"})}:{}),redirect:"manual",signal:AbortSignal.timeout(55_000)});
  if(!response.ok||!response.body)throw Error("local");const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
  try{while(true){const next=await reader.read();if(next.done)break;count+=next.value.byteLength;if(count>GMGN_CORROBORATION_BYTES+100_000)throw Error("bound");parts.push(next.value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const raw=JSON.parse(new TextDecoder().decode(bytes));
  if(command==="collect")console.log(JSON.stringify(raw));else if(command==="read")console.log(JSON.stringify(GmgnCorroborationReportSchema.parse(raw),null,2));else{
   const report=await replayGmgnCorroboration(raw),dir=new URL("../.tmp/",import.meta.url);mkdirSync(dir,{recursive:true});const target=new URL(`gmgn-rpc-${value}-${randomUUID()}.json`,dir);writeFileSync(target,JSON.stringify(raw),{flag:"wx",mode:0o600});console.log(JSON.stringify({artifact:fileURLToPath(target),replay:"verified",report_hash:report.report_hash,provider_requests:0,database_writes:0}));
  }
 }else throw Error("usage");
}catch{console.error("GMGN RPC operation failed; use collect UUID | read UUID | freeze UUID | replay FILE. Inspect local controls/cache before retrying; a lost response is not zero IO. No credentials printed.");process.exitCode=1;}
