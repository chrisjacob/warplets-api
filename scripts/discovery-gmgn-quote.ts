import{lstatSync,mkdirSync,readFileSync,writeFileSync}from"node:fs";
import{randomUUID}from"node:crypto";import{fileURLToPath}from"node:url";
import{GmgnQuoteReportSchema,replayGmgnQuote,reviewGmgnQuote}from"../discovery/src/gmgn-quote";
import{GMGN_CORROBORATION_BYTES}from"../discovery/src/gmgn-corroboration-model";
const maximum=GMGN_CORROBORATION_BYTES+200_000;
let phase="arguments",httpStatus:number|null=null;
async function save(raw:unknown){const report=await replayGmgnQuote(raw),dir=new URL("../.tmp/",import.meta.url);mkdirSync(dir,{recursive:true});const target=new URL(`gmgn-quote-${report.activity_id}-${randomUUID()}.json`,dir);writeFileSync(target,JSON.stringify(raw),{flag:"wx",mode:0o600});console.log(JSON.stringify({artifact:fileURLToPath(target),replay:"verified",report_hash:report.report_hash,provider_requests:0,database_writes:0}));}
try{
 const[command,value,...extra]=process.argv.slice(2);if(extra.length||!value)throw Error("usage");
 if(command==="review"){
  phase="offline_review";const stat=lstatSync(value);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>GMGN_CORROBORATION_BYTES+100_000)throw Error("bound");const comparison:unknown=JSON.parse(readFileSync(value,"utf8"));await save({version:"gmgn-quote-replay-v1",comparison,report:await reviewGmgnQuote(comparison)});
 }else if(command==="replay"){
  phase="offline_replay";
  const stat=lstatSync(value);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximum)throw Error("bound");const report=await replayGmgnQuote(JSON.parse(readFileSync(value,"utf8")));console.log(JSON.stringify({replay:"verified",report_hash:report.report_hash,provider_requests:0,database_writes:0}));
 }else if(["read","freeze"].includes(command!)&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)){
  phase="local_configuration";
  const headers:Record<string,string>={};if(command==="freeze"){const token=readFileSync(new URL("../discovery/.dev.vars",import.meta.url),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];if(!token)throw Error("config");headers.authorization=`Bearer ${token}`;}
  phase="local_request";const response=await fetch(`http://127.0.0.1:8794/api/10x/${command==="freeze"?"admin/":""}gmgn/quote/${value}`,{headers,redirect:"manual",signal:AbortSignal.timeout(55_000)});httpStatus=response.status;phase="local_response";
  if(!response.ok||!response.body)throw Error("local");const reader=response.body.getReader(),parts:Uint8Array[]=[];let count=0;
  try{while(true){const next=await reader.read();if(next.done)break;count+=next.value.byteLength;if(count>maximum)throw Error("bound");parts.push(next.value);}}finally{await reader.cancel();reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}const raw=JSON.parse(new TextDecoder().decode(bytes));
  phase="report_verification";if(command==="read")console.log(JSON.stringify(GmgnQuoteReportSchema.parse(raw),null,2));else{
   await save(raw);
  }
 }else throw Error("usage");
}catch{console.error(JSON.stringify({error:"gmgn_quote_review_failed",phase,http_status:httpStatus}));console.error("Use read UUID | freeze UUID | review COMPARISON_FILE | replay FILE. Saved evidence only; no collection command or credentials printed.");process.exitCode=1;}
