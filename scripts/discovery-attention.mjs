import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";

export function attentionOperatorRequest(args) {
  if(args.length===1&&args[0]==="read")return{path:"discovery/attention",method:"GET"};
  if(args.length===1&&args[0]==="review")return{path:"admin/discovery/attention/review",method:"POST",body:{reason:"Founder authorized focused hourly attention market review"}};
  if(args.length===1&&args[0]==="candles")return{path:"admin/discovery/attention/candles",method:"POST",body:{reason:"Founder authorized focused hourly attention candle review"}};
  if(args.length===1&&args[0]==="traders")return{path:"admin/discovery/attention/traders",method:"POST",body:{reason:"Founder authorized focused hourly attention trader review"}};
  if(args.length===1&&args[0]==="activity")return{path:"admin/discovery/attention/activity",method:"POST",body:{reason:"Founder authorized focused hourly attention wallet-event review"}};
  if(args.length===2&&args[0]==="collect"&&["gmgn","geckoterminal"].includes(args[1]))return{path:"admin/discovery/attention/collect",method:"POST",body:{source:args[1],reason:"Founder authorized hourly provider-attention collection"}};
  if(args[0]==="crosscheck"&&["solana","base","bsc","robinhood"].includes(args[1])&&args.length>=3&&args.length<=32){
    const chain=args[1],addresses=args.slice(2),valid=chain==="solana"?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/:/^0x[0-9a-fA-F]{40}$/;
    if(addresses.some(a=>!valid.test(a))||new Set(addresses.map(a=>chain==="solana"?a:a.toLowerCase())).size!==addresses.length)throw Error("Provide distinct contracts for the selected chain");
    return{path:"admin/discovery/shortlist-query",method:"POST",body:{request_id:randomUUID(),reason:"Founder authorized bounded attention market cross-check",request:{kind:"attention_dex_crosscheck",chain,addresses}}};
  }
  throw Error("Use read | review | candles | traders | activity | collect gmgn|geckoterminal | crosscheck CHAIN ADDRESS [ADDRESS...]");
}
// Local timer only. Admission, hourly deduplication and failure backoff remain
// server-side; never sleep/retry a provider or invent an additional allowance.
export async function collectAttentionOnTick(base, token, signal, fetcher=fetch) {
  if(base!=="http://127.0.0.1:8794")throw Error("attention_tick_local_only");
  const results=[];
  for(const source of ["gmgn","geckoterminal","review","candles","traders","activity"]){
    const followup=["review","candles","traders","activity"].includes(source);
    const response=await fetcher(`${base}/api/10x/admin/discovery/attention/${followup?source:"collect"}`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({...(followup?{}:{source}),reason:"Local hourly attention collection and focused trading review before market refresh"}),signal,redirect:"manual"});
    if(!response.ok){await response.body?.cancel();results.push({source,state:"held",http_status:response.status});continue;}
    const result=await response.json();results.push({source,state:result.state,provider_requests:result.provider_requests,reason:result.reason});
  }
  return results;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),out=args.indexOf("--out"),output=out<0?null:args[out+1];
    if(out>=0){if(!output||out!==args.length-2)throw Error("--out requires one new private output filename");args.splice(out,2);}
    const operation=attentionOperatorRequest(args),root=fileURLToPath(new URL("../",import.meta.url));
    const target=output?path.resolve(root,output):null;
    if(target&&(!target.startsWith(path.join(root,".tmp")+path.sep)||existsSync(target)))throw Error("Use a new private output under .tmp");
    const token=readFileSync(path.join(root,"discovery/.dev.vars"),"utf8").match(/^TENX_ADMIN_TOKEN=([a-f0-9]{64})\s*$/m)?.[1];if(!token)throw Error("Local operator configuration required");
    const response=await fetch(`http://127.0.0.1:8794/api/10x/${operation.path}`,{method:operation.method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},...(operation.body?{body:JSON.stringify(operation.body)}:{}),redirect:"manual",signal:AbortSignal.timeout(40000)});
    const result=await response.json();if(!response.ok)throw Error(`Local query rejected (HTTP ${response.status})`);
    if(target)writeFileSync(target,JSON.stringify({received_at:new Date().toISOString(),operation,result},null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({state:result.state,provider_requests:result.provider_requests,returned:result.observation?.returned,normalized:result.observation?.rows?.length,observed_tokens:result.observed_tokens,snapshot_count:result.snapshot_count,error:result.error,reason:result.reason,output_saved:!!output}));
  }catch{console.error("Attention operation failed. Inspect local availability, arguments and private output path; no automatic retry or quota reset was attempted.");process.exitCode=1;}
}
