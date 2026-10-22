import{z}from"zod";
import{Signature}from"./model";
import{WalletTransactionSchema,signer}from"./wallet-rpc";
import{canonicalPool}from"./pump";
import{verifiedTrades}from"./wallet-trades";
import{GmgnCorroborationReportSchema,GmgnCorroborationStatusSchema as Status}from"./gmgn-corroboration-model";
export const GmgnComparisonEvent=z.object({tx_hash:Signature,event_type:z.string().optional(),type:z.string().optional(),timestamp:z.union([z.number(),z.string().transform(Number)]).nullable().optional(),token_amount:z.unknown()}).passthrough();
function rawQuantity(value:unknown,decimals:number):bigint|null{
  const text=typeof value==="string"?value:typeof value==="number"&&Number.isSafeInteger(value)&&value>=0?String(value):"";
  if(text.length>100||!/^\d+(?:\.\d+)?$/.test(text))return null;
  const[whole,fraction=""]=text.split(".");if(fraction.slice(decimals).replaceAll("0","").length)return null;
  return BigInt(whole!)*10n**BigInt(decimals)+BigInt(fraction.slice(0,decimals).padEnd(decimals,"0")||"0");
}
export async function compareGmgnEventGroups({events,address,wallet,cache,held}:{events:z.infer<typeof GmgnComparisonEvent>[];address:string;wallet:string;cache:Map<string,z.infer<typeof WalletTransactionSchema>>;held:boolean}){
  if(events.length>20)throw Error("gmgn_rpc_event_bound");
  const tradeEvents=events.filter(row=>["buy","sell"].includes(row.event_type??row.type??""));
  const grouped=new Map<string,typeof tradeEvents>();for(const row of tradeEvents){const key=row.tx_hash+":"+(row.event_type??row.type);grouped.set(key,[...(grouped.get(key)??[]),row]);}
  const pool=(await canonicalPool(address)).pool,groups:z.infer<typeof GmgnCorroborationReportSchema>["groups"]=[];let exact=0,aggregate=0;
  for(const rows of grouped.values()){
    const first=rows[0]!,side=first.event_type??first.type!,tx=cache.get(first.tx_hash);let status:z.infer<typeof Status>="cache_missing",count=0;
    if(tx&&!held){
      if(!tx.meta||tx.meta.err!==null)status="transaction_failed";
      else if(rows.some(row=>!row.timestamp||row.timestamp!==tx.blockTime))status="time_conflict";
      else{
        const parsed=await verifiedTrades(tx,address,pool,{temporaryWsol:true}).catch(()=>({trades:[],gaps:["parser_unusable"]}));
        const own=parsed.trades.filter(t=>t.wallet===wallet&&t.side===side);count=own.length;
        if(count>100)throw Error("gmgn_rpc_instruction_bound");
        if(parsed.gaps.some(g=>g!=="native_quote_amount_unmeasured"))status="parser_held";
        else if(!signer(tx,wallet)||!own.length)status="wallet_or_side_not_supported";
        else{
          const decimals=[...new Set([...tx.meta.preTokenBalances,...tx.meta.postTokenBalances].filter(b=>b.mint===address).map(b=>b.uiTokenAmount.decimals))];
          const amounts=decimals.length===1?rows.map(row=>rawQuantity(row.token_amount,decimals[0]!)):[];
          if(!amounts.length||amounts.some(n=>n===null))status="quantity_unknown";
          else{
            const raw=amounts as bigint[],chain=own.map(t=>BigInt(t.base_amount_raw)),order=(a:bigint,b:bigint)=>a<b?-1:a>b?1:0;
            raw.sort(order);chain.sort(order);
            if(raw.length===chain.length&&raw.every((n,i)=>n===chain[i])){status="exact_instruction_quantities";exact+=rows.length;}
            else if(raw.reduce((a,b)=>a+b,0n)===chain.reduce((a,b)=>a+b,0n)){status="aggregate_quantity_only";aggregate+=rows.length;}
            else status="quantity_conflict";
          }
        }
      }
    }
    groups.push({events:rows.length,parsed_instructions:count,status});
  }
  return{groups,exact,aggregate};
}
