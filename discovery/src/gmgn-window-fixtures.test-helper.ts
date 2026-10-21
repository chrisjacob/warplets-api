import { gmgnCandlePart } from "./gmgn-request";
export const windowId="10000000-0000-4000-8000-000000000001", windowAddress="So11111111111111111111111111111111111111112";
export const windowEnd="2026-10-21T07:00:00.000Z", windowStart="2026-10-21T01:00:00.000Z";
export function windowEntries() {
  return Array.from({length:4},(_,part)=>{
    const series={id:windowId,start_at:windowStart,end_at:windowEnd,part};
    const request={kind:"gmgn_token_candles" as const,address:windowAddress,...gmgnCandlePart(series),series};
    const list=Array.from({length:100},(_,i)=>{
      const minute=Math.min(part*100,260)+i,price=.0075+minute*.0000001,volume=10+minute%5;
      return {time:Date.parse(request.start_at)+i*60_000,open:price,high:price*1.001,low:price*.999,close:price,
        volume:String(volume),amount:String(volume/price)};
    });
    return {id:`00000000-0000-4000-8000-00000000000${part+1}`,request,state:"succeeded" as const,received_at:new Date(Date.parse(windowEnd)+22_000+part*11_000).toISOString(),
      receipt_hash:"a".repeat(64),response:{code:0,data:{list}}};
  });
}
