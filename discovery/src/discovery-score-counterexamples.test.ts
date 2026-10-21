import {expect,it} from "vitest";
import {fixtureCandidates} from "./fixtures";
import {defaultScoreInputV4,evaluateDiscoveryScoreV4} from "./discovery-score-v4";
import {assess,DEFAULT_POLICY} from "./model";

// Synthetic controls inspired by a retrospective founder counterexample.
// These are not Kimchi source receipts or labels of verified organic activity.
const at=new Date("2026-10-21T13:00:00.000Z");
async function input(cap:number,liquidity=5000000){const c=(await fixtureCandidates(at))[0]!;return defaultScoreInputV4({...c,market:{...c.market!,market_cap_usd:cap,liquidity_usd:liquidity}},at);}
it("does not lower the frozen v4 grade or action status merely for reaching $10M+ within a day",async()=>{
  const baseline=await input(1000000),runner=await input(40000000),before=structuredClone(runner);
  const expected=evaluateDiscoveryScoreV4(baseline),actual=evaluateDiscoveryScoreV4(runner);
  expect(actual).toMatchObject({value:expected.value,base_points:expected.base_points,ceiling:expected.ceiling,evidence_coverage:expected.evidence_coverage,concerns:expected.concerns});
  expect(assess(runner.candidate,DEFAULT_POLICY,at)).toMatchObject({eligibility:assess(baseline.candidate,DEFAULT_POLICY,at).eligibility});
  expect(runner).toEqual(before);expect(evaluateDiscoveryScoreV4(runner).launch_review.early_reported_cap_usd).toBeNull();
});
it("does not let a high-cap runner narrative waive thin-depth concerns or active-authority evidence",async()=>{
  const thin=await input(40000000,10000);expect(evaluateDiscoveryScoreV4(thin).concerns.some(c=>c.code==="thin_reported_depth_relative_to_cap")).toBe(true);
  const authority=await input(40000000);authority.candidate.risk.mint_authority="active";expect(evaluateDiscoveryScoreV4(authority).ceiling).toBeLessThanOrEqual(40);
});
it("keeps the separate frozen ten-minute early-valuation rule distinguishable from the retired 24h warning",async()=>{
  const value=await input(40000000);value.first_market={source:value.candidate.market!.source,fetched_at:new Date(Date.parse(value.candidate.creation!.block_time)+60000).toISOString(),observed_at:null,market_cap_usd:6000000};
  expect(evaluateDiscoveryScoreV4(value).concerns.some(c=>c.code==="high_early_reported_valuation")).toBe(true);
});
