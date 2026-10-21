import { createHash, randomUUID } from "node:crypto";

export function gmgnWindowPlan(address, now = new Date(), id = randomUUID(), window) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error("Invalid candle window identity");
  const end = window ? Date.parse(window.end_at) : Math.floor(now.getTime()/60_000)*60_000;
  const start = window ? Date.parse(window.start_at) : end-21_600_000;
  if (!Number.isFinite(start) || end-start!==21_600_000 || start%60_000 || end>Math.floor(now.getTime()/60_000)*60_000) throw new Error("Invalid closed candle window");
  const series={id,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString()};
  return { window_id:id, requests:Array.from({length:4},(_,part)=>{
    const bytes=createHash("sha256").update(id+":"+part).digest();bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=bytes.subarray(0,16).toString("hex"),request_id=h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
    const from=start+Math.min(part*100,260)*60_000;
    return {path:"admin/gmgn/review",method:"POST",body:{reason:"Founder authorized complete bounded candle window investigation",request_id,mode:"retained_research",
      request:{kind:"gmgn_token_candles",address,start_at:new Date(from).toISOString(),end_at:new Date(from+6_000_000).toISOString(),series:{...series,part}}}};
  }) };
}

// Exactly four declared slots, never a retry loop or quota bypass. Backoff is
// returned to the operator; only ordinary <=20s request spacing is awaited.
export async function collectGmgnWindow(plan, call, { now=Date.now, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), existing=[] }={}) {
  let requests=0;
  try {
  for (let part=0;part<4;part++) {
    const old=existing.find(row=>row.part===part);
    if(old){if(old.state==="succeeded")continue;return {state:"held",reason:"existing_failed_or_pending_part",window_id:plan.window_id,provider_requests:requests};}
    const status=await call({path:"admin/gmgn/status",method:"GET"});
    if(!status.key_configured||!status.retained_research_permitted)return {state:"held",reason:"configuration_or_permission",window_id:plan.window_id,provider_requests:requests};
    if(Date.parse(status.transport?.backoff_until??"")>now())return {state:"held",reason:"provider_backoff",window_id:plan.window_id,provider_requests:requests};
    const next=Date.parse(status.transport?.next_at??"");
    const delay=Number.isFinite(next)?Math.max(0,next-now()):0;
    if(delay>20_000)return {state:"held",reason:"pacing",window_id:plan.window_id,provider_requests:requests};
    if(delay>0)await sleep(delay);
    const result=await call(plan.requests[part]);requests+=result.provider_requests??0;
    if(result.state!=="retained")return {state:result.state,reason:result.reason??"part_failed",window_id:plan.window_id,provider_requests:requests,request_id:result.request_id};
  }
  const report=await call({path:"admin/gmgn/windows/"+plan.window_id,method:"GET"});
  return {state:report.complete_window?"complete":"partial",window_id:plan.window_id,provider_requests:requests,report};
  } catch {
    // A lost local response can follow an actual provider attempt. Preserve the
    // identity for cache inspection; never report that unknown attempt as zero.
    return {state:"held",reason:"local_operation_interrupted_inspect_saved_window",window_id:plan.window_id,
      provider_requests:null,confirmed_provider_requests:requests};
  }
}
