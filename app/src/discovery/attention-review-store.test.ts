import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildAttentionQueue } from "../../../discovery/src/attention-queue";
import { normalizeAttention } from "../../../discovery/src/attention-feed-contract";
import { normalizeAttentionTraders } from "../../../discovery/src/attention-traders";
import { AttentionActivityReview } from "../../../discovery/src/attention-activity-model";
import { normalizeGmgnWalletActivity } from "../../../discovery/src/gmgn-wallet-activity";
import { previewAttentionReviewImport,restoreAttentionReviews } from "./attention-review-import";
import { ATTENTION_REVIEW_KEY, AttentionReviewLabels, REVIEW_BYTE_LIMIT, appendAttentionReview, captureAttentionReview, exportAttentionReviews,
  parseAttentionReviews, reviewDay, reviewHash, reviewHead, saveAttentionReview, AttentionReviewContext, type ReviewLabels } from "./attention-review-store";

const at=new Date("2026-10-22T14:00:00.000Z"),address="0x0000000000000000000000000000000000001234";
const snapshot=normalizeAttention({kind:"gmgn_hot_searches",chains:["base","bsc"],intervals:["24h"]},{code:0,data:["base","bsc"].map(chain=>({chain,interval:"24h",tokens:[{address,symbol:"MEME",visiting_count:10}]}))},at.toISOString());
const report=()=>buildAttentionQueue([snapshot],at),context=()=>captureAttentionReview(report(),address,"base");
const labels:ReviewLabels={decision:"follow",relevance:"memecoin",catalyst:"A clearly explained current catalyst",concerns:"Organic participation is still unknown",rationale:"Explain why this meme deserves another review",outcome:"not_followed_up",outcome_note:""};
function storage(){let raw:string|null=null;return{getItem:vi.fn((_key:string)=>raw),setItem:vi.fn((_key:string,value:string)=>{raw=value;}),raw:()=>raw};}

it("uses deterministic SHA-256 serialization and the Sydney review date",async()=>{
 expect(await reviewHash({b:2,a:1})).toBe(createHash("sha256").update('{"a":1,"b":2}').digest("hex"));
 expect(await reviewHash({b:2,a:1})).toBe(await reviewHash({a:1,b:2}));expect(reviewDay(at)).toBe("2026-10-23");
});
it("captures exact chain/contract and keeps the source snapshot unchanged by later queue edits",()=>{
 const queue=report(),captured=captureAttentionReview(queue,address,"base");queue.rows[0]!.search_interest=999;expect(captured.token.search_interest).toBe(10);expect(captured.token.chain).toBe("base");
 expect(()=>captureAttentionReview(queue,address,"solana")).toThrow("subject_missing");
});
it("appends linked revisions without mutating earlier notes or observations, separating equal contracts across chains",async()=>{
 const first=await appendAttentionReview(await parseAttentionReviews(null),context(),labels,at),original=JSON.stringify(first.records[0]);
 const second=await appendAttentionReview(first,context(),{...labels,outcome:"attention_faded",outcome_note:"Reported attention faded in my later review"},new Date(at.getTime()+86400000));
 expect(JSON.stringify(second.records[0])).toBe(original);expect(second.records[1]).toMatchObject({revision:2,previous_hash:first.records[0]!.hash,previous_review_hash:first.records[0]!.hash});
 const third=await appendAttentionReview(second,captureAttentionReview(report(),address,"bsc"),labels,new Date(at.getTime()+86400000));expect(third.records[2]).toMatchObject({revision:1,previous_review_hash:null,previous_hash:second.records[1]!.hash});
 expect(await parseAttentionReviews(JSON.stringify(third))).toEqual(third);
});
it("rejects edits, reordered/deleted middle records, wrong dates and future source contexts",async()=>{
 let ledger=await parseAttentionReviews(null);for(let i=0;i<3;i++)ledger=await appendAttentionReview(ledger,context(),labels,new Date(at.getTime()+i));
 const changed=structuredClone(ledger);changed.records[0]!.labels.rationale="Silently altered original explanation";await expect(parseAttentionReviews(JSON.stringify(changed))).rejects.toThrow();
 const deleted=structuredClone(ledger);deleted.records.splice(1,1);await expect(parseAttentionReviews(JSON.stringify(deleted))).rejects.toThrow();
 const reversed=structuredClone(ledger);reversed.records.reverse();await expect(parseAttentionReviews(JSON.stringify(reversed))).rejects.toThrow();
 const wrongDay=structuredClone(ledger);wrongDay.records[0]!.review_day="2026-10-22";await expect(parseAttentionReviews(JSON.stringify(wrongDay))).rejects.toThrow();
 await expect(appendAttentionReview(ledger,context(),labels,new Date(at.getTime()-1))).rejects.toThrow();
 const future=context();future.as_of=new Date(at.getTime()-1).toISOString();await expect(appendAttentionReview(ledger,future,labels,at)).rejects.toThrow();
});
it("requires explainable follow and outcome labels, retains unknowns, and rejects oversized/control text",()=>{
 expect(AttentionReviewLabels.safeParse({...labels,catalyst:""}).success).toBe(false);expect(AttentionReviewLabels.safeParse({...labels,outcome:"still_active",outcome_note:""}).success).toBe(false);
 expect(AttentionReviewLabels.safeParse({...labels,decision:"needs_evidence",relevance:"uncertain",catalyst:""}).success).toBe(true);
 expect(AttentionReviewLabels.safeParse({...labels,concerns:"x".repeat(601)}).success).toBe(false);expect(AttentionReviewLabels.safeParse({...labels,rationale:"untrusted\u0000control"}).success).toBe(false);
});
it("refuses stale-tab saves and leaves failed, corrupt and oversized storage untouched",async()=>{
 const store=storage(),first=await saveAttentionReview(store,null,context(),labels,at),saved=store.raw();
 await expect(saveAttentionReview(store,null,context(),labels,at)).rejects.toThrow("history_changed");expect(store.raw()).toBe(saved);
 store.setItem.mockImplementation(()=>{throw Error("QuotaExceededError");});await expect(saveAttentionReview(store,reviewHead(first),context(),labels,at)).rejects.toThrow();expect(store.raw()).toBe(saved);
 const corrupt={getItem:()=>"broken",setItem:vi.fn()};await expect(saveAttentionReview(corrupt,null,context(),labels,at)).rejects.toThrow();expect(corrupt.setItem).not.toHaveBeenCalled();
 await expect(parseAttentionReviews(" ".repeat(REVIEW_BYTE_LIMIT+1))).rejects.toThrow("storage_bound");await expect(parseAttentionReviews(JSON.stringify({version:"attention-personal-reviews-v1",records:Array(201).fill({})}))).rejects.toThrow();
});
it("detects writes during hashing and exports verified local history with all adoption gates closed",async()=>{
 const race={getItem:vi.fn().mockReturnValueOnce(null).mockReturnValue("changed"),setItem:vi.fn()};await expect(saveAttentionReview(race,null,context(),labels,at)).rejects.toThrow("history_changed");expect(race.setItem).not.toHaveBeenCalled();
 const store=storage();await saveAttentionReview(store,null,context(),labels,at);const exported=await exportAttentionReviews(store,at);expect(exported).toMatchObject({export_version:"attention-personal-review-export-v1",provider_requests:0,evidence_gates_changed:false,scoring_effect:"none",launch_enabled:false});expect(exported.records).toHaveLength(1);expect(store.setItem).toHaveBeenCalledWith(ATTENTION_REVIEW_KEY,expect.any(String));
});
it("preserves old v1 hashes without a trader field and freezes new samples through export and replay",async()=>{
 const original=context(),hash=await reviewHash(original);expect(Object.hasOwn(original,"trader_review")).toBe(false);
 expect(Object.hasOwn(original,"activity_review")).toBe(false);
 expect(Object.hasOwn(original,"activity_issue")).toBe(false);
 expect(await reviewHash(AttentionReviewContext.parse(JSON.parse(JSON.stringify(original))))).toBe(hash);
 const old=await appendAttentionReview(await parseAttentionReviews(null),original,labels,at);expect(await parseAttentionReviews(JSON.stringify(old))).toEqual(old);
 const mint="So11111111111111111111111111111111111111112",queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},{code:0,data:[{chain:"sol",interval:"24h",tokens:[{address:mint}]}]},at.toISOString())],at);
 queue.trader_reviews=[normalizeAttentionTraders("attention-traders-2026102214",{kind:"gmgn_token_traders",address:mint},{code:0,data:{list:[]}},at.toISOString())];
 queue.activity_reviews=[AttentionActivityReview.parse({chain:"solana",address:mint,request_id:"10000000-0000-4000-8000-000000000001",received_at:at.toISOString(),selection_received_at:at.toISOString(),response_identity:"token_echo_wallet_request_context",
  activity:normalizeGmgnWalletActivity({activities:[]},{address:mint,selection_id:"attention-traders-2026102214",selection_hash:"a".repeat(64)},at.toISOString())})];
 queue.activity_issues=[{chain:"solana",address:mint,request_id:"10000000-0000-4000-8000-000000000002",received_at:at.toISOString(),http_status:200,error:"source_collection_response_unusable",fields:["activities"]}];
 const captured=captureAttentionReview(queue,mint,"solana");queue.trader_reviews[0]!.sample.returned_rows=100;expect(captured.trader_review?.sample.returned_rows).toBe(0);
 queue.activity_reviews[0]!.activity.returned_events=20;expect(captured.activity_review?.activity.returned_events).toBe(0);
 queue.activity_issues[0]!.fields=[];expect(captured.activity_issue?.fields).toEqual(["activities"]);
 const next=await appendAttentionReview(old,captured,labels,at),raw=JSON.stringify(next);expect(await parseAttentionReviews(raw)).toEqual(next);expect(next.records[0]).toEqual(old.records[0]);
 const exported=JSON.stringify(await exportAttentionReviews({getItem:()=>raw,setItem:vi.fn()},at)),destination=storage(),preview=await previewAttentionReviewImport(destination,exported,at);
 expect((await restoreAttentionReviews(destination,exported,preview,at)).ledger).toEqual(next);expect(await parseAttentionReviews(destination.raw())).toEqual(next);
 const changed=JSON.parse(raw);changed.records[1].context.trader_review.sample.returned_rows=100;await expect(parseAttentionReviews(JSON.stringify(changed))).rejects.toThrow();
 const changedActivity=JSON.parse(raw);changedActivity.records[1].context.activity_review.activity.returned_events=20;await expect(parseAttentionReviews(JSON.stringify(changedActivity))).rejects.toThrow();
 expect(AttentionReviewContext.safeParse({...captured,trader_review:{...captured.trader_review,address:"11111111111111111111111111111111"}}).success).toBe(false);
 expect(AttentionReviewContext.safeParse({...captured,as_of:new Date(at.getTime()-1).toISOString()}).success).toBe(false);
});
