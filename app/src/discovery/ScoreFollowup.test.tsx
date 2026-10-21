import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {ScoreFollowup} from "./ScoreFollowup";
import {ScoreFollowupSchema} from "../../../discovery/src/score-followup-model";
const data=()=>ScoreFollowupSchema.parse({policy:"score-endpoint-followup-v1",at:"2026-10-21T00:00:00.000Z",provider:"dexscreener",state:"waiting",scope:"latest_500_pending_score_cohorts",capped:false,max_batch_slots:5,cooldown_seconds:900,next_window_at:"2026-10-22T00:00:00.000Z",market_next_at:null,market_error:null,counts:{pending:3,baseline_unavailable:1,provider_mismatch:0,identity_unavailable:0,awaiting_window:2,awaiting_target:0,window_closed:0,endpoint_saved:0,cooling_down:0,ready:0},ready:[],provider_requests:0});
it("explains collection holds without turning readiness into completed outcome evidence",()=>{
  const html=renderToStaticMarkup(<ScoreFollowup data={data()} error=""/>);
  for(const text of ["Outcome collection coverage","2 awaiting their collection window","Missing usable baseline: 1","Up to 5 targets","candidate snapshots and action gates stay unchanged","not a guaranteed endpoint","15 minutes","makes no provider requests"])expect(html).toContain(text);
});
it("retains the last state and makes paused source/backoff and capped coverage visible",()=>{
  const d=data();d.capped=true;d.state="paused";d.market_error="market_rate_limited";const html=renderToStaticMarkup(<ScoreFollowup data={d} error="unavailable"/>);
  for(const text of ["last response remains visible","Existing backoff remains in effect","paused","capped view"])expect(html).toContain(text);
});
it("does not invent a collection state when no cached response is available",()=>{
  const html=renderToStaticMarkup(<ScoreFollowup data={null} error="unavailable"/>);expect(html).toContain("No collection state is assumed");expect(html).not.toContain("endpoints saved");
});
