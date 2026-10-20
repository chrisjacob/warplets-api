// Runs in the supervisor process, independently of the launcher's collection timer.
// Fixed loopback endpoints only; no provider calls, external alerts or secrets in reports.
const base="http://127.0.0.1:8794/api/10x";
const codes=new Set(["healthy","degraded","timer_missing","timer_stale","timer_future","api_unreachable","invalid_status"]);
export async function boundedWatchdogJson(response) {
  if(!response.body)throw new Error("invalid_status");
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new Error("invalid_status");chunks.push(value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function checkDiscovery(transport=fetch,clock=()=>new Date()) {
  let code="api_unreachable";
  try {
    const response=await transport(`${base}/system/operations`,{signal:AbortSignal.timeout(5000),redirect:"manual",cache:"no-store"});
    if(response.ok){
      code="invalid_status";
      const {data}=await boundedWatchdogJson(response),now=clock().getTime();
      if(!data || data.scope!=="local_discovery_operations" || data.provider_requests!==0 || data.heartbeat_limit_seconds!==1200 || !["healthy","degraded","paused"].includes(data.state) || !Number.isFinite(Date.parse(data.at)) || Date.parse(data.at)>now || now-Date.parse(data.at)>30000 || !(data.heartbeat_at===null || typeof data.heartbeat_at==="string" && Number.isFinite(Date.parse(data.heartbeat_at))))throw new Error("invalid_status");
      const age=data.heartbeat_at===null?null:now-Date.parse(data.heartbeat_at);
      // Compute age independently; a responsive API alone is not timer health.
      const timer=age===null?"missing":age<0?"future":age>1200000?"stale":"recent";
      // The server and checker can straddle the exact stale boundary.
      if(data.timer!==timer && !(data.timer==="recent" && timer==="stale"))throw new Error("invalid_status");
      code=timer!=="recent"?`timer_${timer}`:data.state==="degraded"?"degraded":"healthy";
    }else await response.body?.cancel();
  } catch { /* Keep bounded failure code, never a response body or credential. */ }
  return {version:"local-watchdog-v1",checked_at:clock().toISOString(),code,restart_recommended:!["healthy","degraded"].includes(code)};
}
export function watchdogDecision(previous,report,owned) {
  if(!codes.has(report.code) || report.restart_recommended!==!["healthy","degraded"].includes(report.code))throw new Error("invalid_watchdog_code");
  const failures=report.restart_recommended?(previous?.failures??0)+1:0;
  return {failures,action:failures<3?"observe":owned?"restart_owned":"report_unowned"};
}
export function restartAllowance(times,now=Date.now()) {
  const recent=times.filter(at=>Number.isFinite(at)&&at<=now&&now-at<900000);
  return {recent,allowed:recent.length<3};
}
export async function publishWatchdog(report,token,transport=fetch) {
  if(!token)return false;
  try {const response=await transport(`${base}/admin/watchdog`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({reason:"Independent local supervisor check",report}),signal:AbortSignal.timeout(5000),redirect:"manual"});const ok=response.ok;await response.body?.cancel();return ok;}catch{return false;}
}
