import { expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttentionActivityDetails } from "./AttentionActivityDetails";
import { AttentionActivityReview } from "../../../discovery/src/attention-activity-model";
import { normalizeGmgnWalletActivity,normalizeGmgnWalletActivityResearch } from "../../../discovery/src/gmgn-wallet-activity";
import { describeGmgnActivity } from "../../../discovery/src/gmgn-activity-shape";
export const activityFixture=()=>{const time="2026-10-22T14:00:00.000Z",address="So11111111111111111111111111111111111111112";
 return AttentionActivityReview.parse({chain:"solana",address,request_id:"10000000-0000-4000-8000-000000000001",received_at:time,selection_received_at:time,response_identity:"token_echo_wallet_request_context",
  activity:normalizeGmgnWalletActivity({activities:[{tx_hash:"1".repeat(64),token:{address},event_type:"buy",timestamp:1,token_amount:10},{tx_hash:"2".repeat(64),token:{address},event_type:"buy",timestamp:0,token_amount:10,cost_usd:"-2"}],next:"opaque"},{address,selection_id:"attention-traders-2026102214",selection_hash:"a".repeat(64)},time)});};
export const researchActivityFixture=()=>{const review=activityFixture();return AttentionActivityReview.parse({...review,activity:normalizeGmgnWalletActivityResearch({activities:Array.from({length:50},(_,i)=>({tx_hash:"1".repeat(64),token:{address:review.address},event_type:"buy",timestamp:i+1,token_amount:10,cost_usd:2})),next:"opaque"},{address:review.address,selection_id:review.activity.source_request_id,selection_hash:review.activity.source_receipt_hash},review.received_at)});};
it("distinguishes the request from a validated fifty-event response without triggering RPC",()=>{
 const fetcher=vi.spyOn(globalThis,"fetch"),review=researchActivityFixture(),html=renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={review} asOf={review.received_at}/>);
 for(const text of["50 received","Requested 20 events; received 50","50-event research cap; no rows discarded","Independent transaction comparison remains held","do not establish wash trading"])expect(html).toContain(text);
 expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
 const held=renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={undefined} issue={{chain:"solana",address:review.address,request_id:review.request_id,received_at:review.received_at,http_status:200,error:"source_collection_response_unusable",fields:["activities"],shape:describeGmgnActivity({activities:Array.from({length:51},()=>({}))},[],50)}} asOf={review.received_at}/>);
 expect(held).toContain("accepts at most 50");expect(held).not.toContain("accepts at most 20");
});
it("separates pending and unsupported chain states",()=>{
 expect(renderToStaticMarkup(<AttentionActivityDetails chain="base" review={undefined} asOf="2026-10-22T14:00:00.000Z"/>)).toContain("not connected for this chain");
 expect(renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={undefined} asOf="2026-10-22T14:00:00.000Z"/>)).toContain("review pending");
});
it("keeps failed attempts visible beside an earlier accepted sample without a passing claim",()=>{
 const review=activityFixture(),issue={chain:"solana" as const,address:review.address,request_id:review.request_id,received_at:review.received_at,http_status:200,error:"source_collection_response_unusable" as const,fields:["activities"],shape:describeGmgnActivity({activities:null})};
 for(const sample of[undefined,review]){const html=renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={sample} issue={issue} asOf={review.received_at}/>);expect(html).toContain("Wallet-event attempt held");expect(html).toContain("activities");expect(html).toContain("hourly attempt remains spent");expect(html).toContain("Expected event array: null");expect(html).toContain(sample?"2/20 returned":"No accepted wallet-event sample");}
});
it("renders sample scope, time, pagination, missing USD and descriptive cues without source IO",()=>{
 const fetcher=vi.spyOn(globalThis,"fetch"),review=activityFixture(),html=renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={review} asOf={review.received_at}/>);
 for(const text of["2/20 returned","review cues","Targeted selection; population coverage unknown","More pages reported; not fetched","1 trade events with unknown time","Sample buy USD Unknown","1 missing, 0 unusable and 1 unresolved signed","2 events in repeated same-side size groups","their absence does not prove safety"])expect(html).toContain(text);
 expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();expect(renderToStaticMarkup(<AttentionActivityDetails chain="solana" review={review} asOf="2026-10-22T16:00:00.001Z"/>)).toContain("stale");
});
