import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {AttentionCandleDetails,AttentionQueuePanel,AttentionQueueValues} from "./AttentionQueue";
import {normalizeAttentionCandles} from "../../../discovery/src/attention-candles";
import {buildAttentionQueue} from "../../../discovery/src/attention-queue";
import {normalizeAttention} from "../../../discovery/src/attention-feed-contract";

const at=new Date("2026-10-22T14:00:00.000Z"),address="0x0000000000000000000000000000000000001234";
const snapshot=normalizeAttention({kind:"gmgn_hot_searches",chains:["base"],intervals:["24h"]},{code:0,data:[{chain:"base",interval:"24h",tokens:[{address,name:"Established meme",symbol:"MEME",visiting_count:120,rank:2,open_timestamp:at.getTime()/1000-8640000}]}]},at.toISOString());
it("shows an older cross-chain token with source provenance and quality unknowns instead of a safety score",()=>{
 const html=renderToStaticMarkup(<AttentionQueueValues report={buildAttentionQueue([snapshot],at)}/>);
 for(const text of["Established meme","base","120 reported search/visit heat","Quality review needed","honeypot status unknown","Token age has no maximum","Launch selection remains unavailable","do not establish organic participation or safety"])expect(html).toContain(text);
 expect(html).not.toContain("Score / 100");expect(html).not.toContain("Safe token");
});
it("hides explicit adverse flags by default while preserving the review control",()=>{
 const adverse=structuredClone(snapshot);adverse.rows[0]!.honeypot=true;
 const html=renderToStaticMarkup(<AttentionQueueValues report={buildAttentionQueue([adverse],at)}/>);expect(html).not.toContain("Established meme");expect(html).toContain("Include adverse security flags");expect(html).toContain("No saved attention observations match");
});
it("renders cache-only refresh and an honest initial state without provider IO",()=>{
 const fetcher=vi.spyOn(globalThis,"fetch");const html=renderToStaticMarkup(<AttentionQueuePanel/>);expect(html).toContain("Refresh saved lists");expect(html).toContain("No attention observations loaded yet");expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
});
it("distinguishes absent, unsupported, incomplete, stale and warning-bearing candle samples",()=>{
 expect(renderToStaticMarkup(<AttentionCandleDetails chain="base" review={undefined} asOf={at.toISOString()}/>)).toContain("not connected for this chain");
 expect(renderToStaticMarkup(<AttentionCandleDetails chain="solana" review={undefined} asOf={at.toISOString()}/>)).toContain("review pending");
 const request={kind:"gmgn_token_candles",address:"So11111111111111111111111111111111111111112",start_at:new Date(at.getTime()-3600000).toISOString(),end_at:at.toISOString()},review=normalizeAttentionCandles("attention-candles-2026102214",request,{code:0,data:[{time:at.getTime()-60000,open:1,high:2,low:1,close:2,volume:0,amount:0}]},at.toISOString());
 const html=renderToStaticMarkup(<AttentionCandleDetails chain="solana" review={review} asOf={at.toISOString()}/>);for(const text of["1/60 minutes","incomplete","price moves with both flow fields zero","Volume units: unverified","do not establish wash trading"])expect(html).toContain(text);
 expect(renderToStaticMarkup(<AttentionCandleDetails chain="solana" review={review} asOf={new Date(at.getTime()+7200001).toISOString()}/>)).toContain("stale");
});
