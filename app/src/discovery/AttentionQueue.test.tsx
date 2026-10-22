import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {AttentionCandleDetails,AttentionTraderDetails,AttentionQueuePanel,AttentionQueueValues,AttentionTokenDetails} from "./AttentionQueue";
import {captureAttentionReview} from "./attention-review-store";
import {normalizeAttentionTraders} from "../../../discovery/src/attention-traders";
import {normalizeAttentionCandles} from "../../../discovery/src/attention-candles";
import {buildAttentionQueue} from "../../../discovery/src/attention-queue";
import {normalizeAttention} from "../../../discovery/src/attention-feed-contract";

const at=new Date("2026-10-22T14:00:00.000Z"),address="0x0000000000000000000000000000000000001234";
const snapshot=normalizeAttention({kind:"gmgn_hot_searches",chains:["base"],intervals:["24h"]},{code:0,data:[{chain:"base",interval:"24h",tokens:[{address,name:"Established meme",symbol:"MEME",visiting_count:120,rank:2,open_timestamp:at.getTime()/1000-8640000}]}]},at.toISOString());
it("shows an older cross-chain token with source provenance and quality unknowns instead of a safety score",()=>{
 const report=buildAttentionQueue([snapshot],at),html=renderToStaticMarkup(<AttentionQueueValues report={report}/>);
 for(const text of["Established meme","base","GMGN","Quality review needed","Token age has no maximum","Launch selection remains unavailable","do not establish organic participation or safety","View evidence"])expect(html).toContain(text);
 expect(html).not.toContain("Score / 100");expect(html).not.toContain("Safe token");
 expect(html).not.toContain("Source ranks &amp; timing");expect(html).not.toContain("Candles and participation");
 const detail=renderToStaticMarkup(<AttentionTokenDetails context={captureAttentionReview(report,address,"base")} onClose={()=>{}}/>);
 for(const text of["120 reported search/visit heat","honeypot status unknown","Reported market activity","Attention sources and timing","Candles and participation","not connected for this chain","stays fixed","Close evidence"])expect(detail).toContain(text);
});
it("keeps the selected identity, snapshot dates, flags and explicit refresh state in a separate detail surface",()=>{
 const report=buildAttentionQueue([snapshot],at),context=captureAttentionReview(report,address,"base");context.token.checks="adverse";
 const fetcher=vi.spyOn(globalThis,"fetch"),html=renderToStaticMarkup(<AttentionTokenDetails context={context} onClose={()=>{}} onReview={()=>{}} reviewBusy newerReport outsideView onUpdate={()=>{}}/>);
 for(const text of[address,"Adverse flags","outside the current shortlist filters","A different saved list is available","Load latest saved evidence","Review this snapshot","Snapshot saved at","Scores and launch checks are unchanged"])expect(html).toContain(text);
 expect(html).toMatch(/disabled=""[^>]*>Review this snapshot/);expect(html).not.toContain("<table");expect(html).not.toContain("<dialog");expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
 const absent=renderToStaticMarkup(<AttentionTokenDetails context={context} onClose={()=>{}} newerReport/>);expect(absent).toContain("absent from that saved list");expect(absent).not.toContain("Load latest saved evidence");
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
it("labels ranked participation, period, missingness and concentration without certifying organic flow",()=>{
 expect(renderToStaticMarkup(<AttentionTraderDetails chain="base" review={undefined} asOf={at.toISOString()}/>)).toContain("not connected for this chain");
 expect(renderToStaticMarkup(<AttentionTraderDetails chain="solana" review={undefined} asOf={at.toISOString()}/>)).toContain("review pending");
 const mint="So11111111111111111111111111111111111111112",review=normalizeAttentionTraders("attention-traders-2026102214",{kind:"gmgn_token_traders",address:mint},{code:0,data:{list:[{address:mint,addr_type:0,buy_volume_cur:10}]}},at.toISOString());
 const html=renderToStaticMarkup(<AttentionTraderDetails chain="solana" review={review} asOf={at.toISOString()}/>);
 for(const text of["1/100 returned","ranked sample saved","Reporting period and population coverage unknown","0 wallet rows with both flow fields","1 missing one or both","Sample buy flow Unknown","largest wallet Unknown","not 24h or organic volume, holder counts or growth","does not establish wash trading"])expect(html).toContain(text);
 expect(renderToStaticMarkup(<AttentionTraderDetails chain="solana" review={review} asOf={new Date(at.getTime()+7200001).toISOString()}/>)).toContain("stale");
});
