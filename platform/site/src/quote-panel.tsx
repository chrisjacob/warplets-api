import {useExperience} from './experience';
import { Capability, useRuntimeQuery } from './capabilities';
import { useEffect,useState } from 'react';
import { useMutation,} from '@tanstack/react-query';
import { z } from 'zod';
import { baseUnits,dollarsMicros,tokenUnits } from './amounts';
import { Facts,friendlyError,Loaded,Panel,percent,Signal } from './common';
import { client } from './sdk';

const integer=z.number().int().nonnegative(),units=z.string().regex(/^\d+$/);
export const availabilityModel=z.object({available:z.boolean(),attDecimals:integer.optional(),ogDecimals:integer.optional(),
  expiresAt:z.string().datetime().optional(),reason:z.string().optional()});
export const swapQuoteModel=z.object({
  id:z.string(),marketId:z.string(),direction:z.enum(['buy-att','sell-att']),inputMint:z.string(),outputMint:z.string(),inputDecimals:integer,outputDecimals:integer,inputUnits:units,
  expectedOutputUnits:units,minimumOutputUnits:units,inputFeeUnits:units,outputFeeUnits:units,feeBps:integer,
  priceImpactBps:units,slippageBps:integer,quotedAt:z.string().datetime(),expiresAt:z.string().datetime(),
  contextSlot:integer,observedAt:z.string().datetime(),sourceHash:z.string(),spotFdvUsdMicros:units,
  effectiveBuyFdvUsdMicros:units.nullable(),executable:z.literal(false),source:z.literal('local-fixture'),
});
type Availability=z.infer<typeof availabilityModel>;
type Quote=z.infer<typeof swapQuoteModel>;
export type QuoteServices={
  availability:(marketId:string,signal:AbortSignal)=>Promise<Availability>;
  quote:(request:{marketId:string;direction:'buy-att'|'sell-att';inputUnits:string;slippageBps:number})=>Promise<Quote>;
};
export const quoteServices:QuoteServices={
  availability:async(marketId,signal)=>availabilityModel.parse((await client.getQuoteAvailability({path:{id:marketId},signal})).data),
  quote:async(body)=>{
    const result=swapQuoteModel.parse((await client.previewSwapQuote({body})).data);
    if(result.marketId!==body.marketId||result.direction!==body.direction||result.inputUnits!==body.inputUnits||result.slippageBps!==body.slippageBps)
      throw Error('The quote does not match the requested trade.');
    return result;
  },
};
function SwapForm({marketId,symbol,ogSymbol,available,services}:{marketId:string;symbol:string;ogSymbol:string;available:Availability;services:QuoteServices}){
  const {technical}=useExperience();
  const [direction,setDirection]=useState<'buy-att'|'sell-att'>('buy-att'),[amount,setAmount]=useState(''),[slippage,setSlippage]=useState('50');
  const [now,setNow]=useState(Date.now()),[inputError,setInputError]=useState('');
  const quote=useMutation({mutationFn:services.quote});
  useEffect(()=>{
    if(!quote.data)return;
    const expiry=Date.parse(quote.data.expiresAt);
    if(expiry<=Date.now()){setNow(Date.now());return;}
    const timer=setTimeout(()=>setNow(Date.now()),expiry-Date.now()+5);
    return()=>clearTimeout(timer);
  },[quote.data]);
  const buy=direction==='buy-att',inputSymbol=buy?ogSymbol:symbol,outputSymbol=buy?symbol:ogSymbol;
  const expired=quote.data && now>=Date.parse(quote.data.expiresAt);
  const dirty=()=>{setInputError('');quote.reset();};
  return <>
    <form className="member-form" onSubmit={event=>{
      event.preventDefault();setInputError('');
      try{
        const decimals=buy?available.ogDecimals:available.attDecimals;
        if(decimals===undefined)throw Error('The token precision is unavailable.');
        if(!/^\d+$/.test(slippage))throw Error('Enter slippage in whole basis points.');
        quote.mutate({marketId,direction,inputUnits:baseUnits(amount,decimals),slippageBps:Number(slippage)});
      }catch(error){setInputError(friendlyError(error));}
    }}>
      <fieldset disabled={quote.isPending}><label htmlFor="quote-direction">Direction</label><select id="quote-direction" value={direction}
        onChange={e=>{setDirection(e.target.value as typeof direction);dirty();}}>
        <option value="buy-att">Buy {symbol}</option><option value="sell-att">Sell {symbol}</option></select>
      <label>Amount in {inputSymbol}<input value={amount} inputMode="decimal" required onChange={e=>{setAmount(e.target.value);dirty();}}/></label>
      {technical?<label>Slippage tolerance in basis points<input type="number" min="0" max="500" required value={slippage}
        onChange={e=>{setSlippage(e.target.value);dirty();}}/></label>:<label>Slippage tolerance<select value={slippage} onChange={e=>{setSlippage(e.target.value);dirty();}}>{[0,10,50,100,200,500].map(bps=><option key={bps} value={bps}>{bps/100}%</option>)}</select></label>}
      <button disabled={quote.isPending}>Preview swap quote</button></fieldset>
      {(inputError||quote.error)&&<Signal>{inputError||friendlyError(quote.error)}</Signal>}
    </form>
    {quote.data&&<section className="quote-result" aria-label="Local swap quote">
      <h3>{expired?'Quote expired':'Local exact-input quote'}</h3>
      <Facts items={[
        ['Input',tokenUnits(quote.data.inputUnits,quote.data.inputDecimals)+' '+inputSymbol],
        ['Expected output',tokenUnits(quote.data.expectedOutputUnits,quote.data.outputDecimals)+' '+outputSymbol],
        ['Minimum received',tokenUnits(quote.data.minimumOutputUnits,quote.data.outputDecimals)+' '+outputSymbol],
        ['Included trading fee',percent(quote.data.feeBps)],
        ['Fee amount',tokenUnits(buy?quote.data.inputFeeUnits:quote.data.outputFeeUnits,buy?quote.data.inputDecimals:quote.data.outputDecimals)+' '+ogSymbol],
        ['Price impact',percent(Number(quote.data.priceImpactBps))],
        ['Spot FDV',dollarsMicros(quote.data.spotFdvUsdMicros)],
        ...(quote.data.effectiveBuyFdvUsdMicros?[['Effective buy FDV',dollarsMicros(quote.data.effectiveBuyFdvUsdMicros)]] as [string,string][]:[]),
        ['Evidence slot',String(quote.data.contextSlot)],['Expires',quote.data.expiresAt.replace('T',' ').replace('Z',' UTC')],
      ]}/>
      <p>Local fixture amounts include the trading fee. Network and token-account costs await a transaction simulation.</p>
      {expired&&<Signal>Refresh the quote with current evidence before reviewing its amounts.</Signal>}
    </section>}
  </>;
}
function SupportedQuotePanel({marketId,symbol,ogSymbol,services}:{marketId:string;symbol:string;ogSymbol:string;services:QuoteServices}){
  const available=useRuntimeQuery('/api/v1/markets/{id}/quote-status',{queryKey:['quote-status',marketId],staleTime:0,queryFn:({signal})=>services.availability(marketId,signal)});
  return <Panel title="Swap quote preview"><Loaded query={available}>{a=>a.available?
    <SwapForm marketId={marketId} symbol={symbol} ogSymbol={ogSymbol} available={a} services={services}/>
    :<><p>A current pool and original-token price observation is required to quote this market.</p>
      <button onClick={()=>void available.refetch()} disabled={available.isFetching}>Check quote availability</button></>}</Loaded></Panel>;
}

export function QuotePanel(props:Parameters<typeof SupportedQuotePanel>[0]){
  return <Capability path="/api/v1/markets/{id}/quote-status"><Capability method="POST" path="/api/v1/quotes"><SupportedQuotePanel {...props}/></Capability></Capability>;
}
