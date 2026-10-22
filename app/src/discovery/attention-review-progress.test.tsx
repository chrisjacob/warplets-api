import {expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {attentionReviewProgress,ATTENTION_FOLLOW_UP_MS as day} from "./attention-review-progress";
import {AttentionReviewProgressValues} from "./AttentionReviewProgress";
import {appendAttentionReview,parseAttentionReviews,captureAttentionReview,reviewDay,type ReviewLabels,type ReviewLedger} from "./attention-review-store";
import {buildAttentionQueue} from "../../../discovery/src/attention-queue";
import {normalizeAttention} from "../../../discovery/src/attention-feed-contract";
const at=new Date("2026-10-20T12:00:00.000Z"),address="0x0000000000000000000000000000000000001234";
const queue=buildAttentionQueue([normalizeAttention({kind:"gmgn_hot_searches"},{code:0,data:["base","bsc"].map(chain=>({chain,interval:"24h",tokens:[{address,symbol:"MEME"}]}))},at.toISOString())],at);
const context=(chain="base")=>captureAttentionReview(queue,address,chain),later=(ms:number)=>new Date(at.getTime()+ms);
const labels:ReviewLabels={decision:"follow",relevance:"memecoin",catalyst:"Synthetic catalyst for this test",concerns:"Independent participation unknown",rationale:"Synthetic personal assessment for testing",outcome:"not_followed_up",outcome_note:""};
const append=(ledger:ReviewLedger,ms=0,patch:Partial<ReviewLabels>={},chain="base")=>appendAttentionReview(ledger,context(chain),{...labels,...patch},later(ms));
const empty=()=>parseAttentionReviews(null);
it("keeps an empty verified history separate from missing market coverage",async()=>{
 const report=await attentionReviewProgress(await empty(),at);expect(report).toMatchObject({tokens:0,revisions:0,awaiting_24h:0,due:0,reported:0,cohorts:[],provider_requests:0,scoring_effect:"none",evidence_gates_changed:false});
 const html=renderToStaticMarkup(<AttentionReviewProgressValues report={report} onFollowUp={()=>{}}/>);expect(html).toContain("not the market or every token shown");expect(html).toContain("No 24h follow-ups due");
});
it("uses the first saved review for maturity and the Sydney cohort, keeping equal contracts on different chains distinct",async()=>{
 let ledger=await append(await empty());ledger=await append(ledger,day,{},"bsc");ledger=await append(ledger,day+3600000,{outcome:"still_active",outcome_note:"Synthetic later observation remained active"});
 const report=await attentionReviewProgress(ledger,later(day+3600000));expect(report).toMatchObject({tokens:2,revisions:3,awaiting_24h:1,due:0,reported:1});expect(report.cohorts.find(c=>c.day===reviewDay(at))).toMatchObject({tokens:1,reported:1,outcomes:{still_active:1}});
 expect(report.rows.map(r=>r.first.context.token.chain)).toEqual(["base","bsc"]);expect(report.rows[0]!.first.review_day).not.toBe(report.rows[0]!.latest.review_day);
});
it("holds the exact 24h boundary and never resets maturity on an edit",async()=>{
 let ledger=await append(await empty());expect((await attentionReviewProgress(ledger,later(day-1))).awaiting_24h).toBe(1);expect((await attentionReviewProgress(ledger,later(day))).due).toBe(1);
 ledger=await append(ledger,day+1000,{decision:"needs_evidence"});expect(await attentionReviewProgress(ledger,later(day+1000))).toMatchObject({due:1,reported:0,rows:[{follow_up_at:later(day).toISOString()}]});
});
it("does not count an early outcome as a 24h follow-up and keeps a later unknown report explicit",async()=>{
 let ledger=await append(await empty());ledger=await append(ledger,day-1,{outcome:"still_active",outcome_note:"Synthetic report before the full interval"});
 expect(await attentionReviewProgress(ledger,later(day))).toMatchObject({due:1,reported:0,early_outcomes:1,cohorts:[{outcomes:{still_active:0,unknown:0}}]});
 ledger=await append(ledger,day+1,{outcome:"unknown",outcome_note:"Synthetic later observation could not be verified"});
 expect(await attentionReviewProgress(ledger,later(day+1))).toMatchObject({due:0,reported:1,early_outcomes:0,cohorts:[{outcomes:{still_active:0,unknown:1}}]});
});
it("uses the latest revision without falling back to an earlier favorable outcome",async()=>{
 let ledger=await append(await empty());ledger=await append(ledger,day,{outcome:"still_active",outcome_note:"Synthetic active observation"});ledger=await append(ledger,day+1);
 expect(await attentionReviewProgress(ledger,later(day+1))).toMatchObject({due:1,reported:0,cohorts:[{outcomes:{still_active:0}}]});
});
it("includes set-aside and uncertain reviews in the due population without source IO or mutation",async()=>{
 let ledger=await append(await empty(),0,{decision:"set_aside",relevance:"uncertain"});ledger=await append(ledger,1000,{decision:"needs_evidence"},"bsc");const original=JSON.stringify(ledger),fetcher=vi.spyOn(globalThis,"fetch");
 const report=await attentionReviewProgress(ledger,later(day+1000));expect(report.due).toBe(2);expect(report.rows.map(r=>r.latest.labels.decision)).toEqual(["set_aside","needs_evidence"]);expect(JSON.stringify(ledger)).toBe(original);report.rows[0]!.latest.labels.rationale="Changed projection";expect(JSON.stringify(ledger)).toBe(original);expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();
});
it("holds malformed history and a clock earlier than any retained revision",async()=>{
 const ledger=await append(await empty());await expect(attentionReviewProgress(ledger,later(-1))).rejects.toThrow("clock_invalid");await expect(attentionReviewProgress(ledger,new Date(NaN))).rejects.toThrow("clock_invalid");
 const changed=structuredClone(ledger);changed.records[0]!.labels.outcome="unknown";await expect(attentionReviewProgress(changed,later(day))).rejects.toThrow();
});
it("bounds the visible due queue without dropping tokens from its denominator",async()=>{
 let ledger=await empty();for(let i=0;i<11;i++){const subject=context();subject.token.address="0x"+(100+i).toString(16).padStart(40,"0");ledger=await appendAttentionReview(ledger,subject,labels,later(i));}
 const report=await attentionReviewProgress(ledger,later(day+11)),html=renderToStaticMarkup(<AttentionReviewProgressValues report={report} onFollowUp={()=>{}}/>);
 expect(report.due).toBe(11);expect(html.match(/>Follow up on this review<\/button>/g)).toHaveLength(10);expect(html).toContain("1 more due tokens remain");
});
it("renders explicit denominators, unknowns and disabled follow-ups without claiming a success rate",async()=>{
 const report=await attentionReviewProgress(await append(await empty()),later(day)),html=renderToStaticMarkup(<AttentionReviewProgressValues report={report} onFollowUp={()=>{}} disabled/>);
 for(const text of["oldest first","MEME · base",address,"Unknown reported","first personal review date in Sydney","Only each token","not independently verified token performance","permission to change scores or launch checks"])expect(html).toContain(text);
 expect(html).toMatch(/disabled=""[^>]*>Follow up on this review/);expect(html).not.toContain("win rate");
});
