import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {ScoreResearch} from "./ScoreResearch";
import {ScoreResearchSchema} from "../../../discovery/src/score-research-model";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
import {defaultScoreInput,freezeDiscoveryScore} from "../../../discovery/src/discovery-score";
import {freezeScoreCohort,freezeScoreOutcome,SCORE_OUTCOME_DELAY} from "../../../discovery/src/score-research-analysis";

const at=new Date("2026-10-21T01:00:00.000Z");
const empty=()=>ScoreResearchSchema.parse({at:at.toISOString(),scope:"latest_500_score_cohorts",capped:false,automatic_policy_changes:false,provider_requests:0,limits:{daily_records:100,daily_bytes:10000000},today:{day:"2026-10-21",records:0,bytes:0},automation:{next_at:null,last_success:null,last_error:null},counts:{captured:0,pending:0,measured:0,insufficient:0},bands:[0,20,40,60,80].map(minimum=>({minimum,maximum:minimum===80?100:minimum+19,captured:0,pending:0,measured:0,insufficient:0,severe_declines:0})),recent:[],attempts:[]});
async function original(){const c={...(await fixtureCandidates(at))[0]!,mode:"live" as const};return freezeScoreCohort(await freezeDiscoveryScore(defaultScoreInput(c,at)));}
it("explains prospective empty research without inventing historic scores or validated weights",()=>{
  const html=renderToStaticMarkup(<ScoreResearch data={empty()} error=""/>);
  for(const text of ["No prospective grades retained yet","past scores are not invented","No extra provider requests","automatic weight changes","Initial score weights remain uncalibrated","not trust categories"])expect(html).toContain(text);
});
it("shows the original grade and coverage with a pending window and exact replay link",async()=>{
  const c=await original(),data=empty();data.recent=[{cohort:c.summary,outcome:null}];const html=renderToStaticMarkup(<ScoreResearch data={data} error=""/>);
  expect(html).toContain(`${c.summary.score.value} / 100`);expect(html).toContain(`${c.summary.score.evidence_coverage}% effective evidence coverage`);expect(html).toContain("Awaiting 24h outcome + collection grace");expect(html).toContain(`/api/10x/research/scores/solana/${c.summary.address}`);expect(html).not.toContain("Price 0.00%");
});
it("keeps missing outcomes insufficient and explains a reported total decline without a fraud verdict",async()=>{
  const c=await original(),data=empty(),finalized_at=new Date(at.getTime()+SCORE_OUTCOME_DELAY).toISOString();
  let o=await freezeScoreOutcome({version:"score-outcome-input-v1",cohort:c.summary,finalized_at,points:[],history_limited:false});data.recent=[{cohort:c.summary,outcome:o.result}];let html=renderToStaticMarkup(<ScoreResearch data={data} error=""/>);expect(html).toContain("Insufficient comparable endpoint");expect(html).toContain("Price Unavailable");
  o=await freezeScoreOutcome({...o.inputs,points:[{...c.summary.baseline!,fetched_at:new Date(at.getTime()+86400000).toISOString(),price_usd:0,liquidity_usd:0}]});data.recent=[{cohort:c.summary,outcome:o.result}];html=renderToStaticMarkup(<ScoreResearch data={data} error=""/>);expect(html).toContain("Sampled severe decline");expect(html).toContain("-100.00%");expect(html).toContain("not proof of a rug pull");
});
it("reports stale refreshes, UTC storage bounds and capture gaps without losing saved observations",()=>{
  const data=empty();data.automation.last_error="score_research_unavailable";data.capped=true;const html=renderToStaticMarkup(<ScoreResearch data={data} error="unavailable"/>);
  for(const text of ["last response remains visible","capped view","Today’s UTC storage","0 / 100 records","0.00 / 10 MB","Research needs attention"])expect(html).toContain(text);
});
