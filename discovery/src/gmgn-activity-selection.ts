import {z} from "zod";
import {Address} from "./model";
import {gmgnTraderRows} from "./gmgn-traders";
import {replayGmgnTraderRecord} from "./gmgn-trader-replay";
export async function gmgnActivitySelection(raw:unknown,now:Date){
  await replayGmgnTraderRecord(raw);
  const record=z.object({request:z.object({address:Address}),receipt:z.object({received_at:z.string().datetime(),response:z.object({data:z.unknown()})}),receipt_hash:z.string()}).parse(raw);
  const age=now.getTime()-Date.parse(record.receipt.received_at);if(age<0||age>86_400_000)throw Error("gmgn_activity_selection_time");
  const rows=gmgnTraderRows(record.receipt.response.data).filter(row=>row.addr_type===0&&row.buy_volume_cur!==null&&row.sell_volume_cur!==null)
    .map(row=>({wallet:row.address,flow:row.buy_volume_cur!+row.sell_volume_cur!}));
  rows.sort((a,b)=>b.flow-a.flow||(a.wallet<b.wallet?-1:a.wallet>b.wallet?1:0));
  if(!rows[0]||!Number.isFinite(rows[0].flow)||rows[0].flow<=0)throw Error("gmgn_activity_selection_no_positive_flow");
  return{address:record.request.address,wallet:rows[0].wallet,selection_hash:record.receipt_hash};
}
