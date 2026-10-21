import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {DiscoveryScoreBadge,DiscoveryScoreMethod,DiscoveryScorePanel} from "./DiscoveryScore";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
import {defaultScoreInput,freezeDiscoveryScore,scoreSummary} from "../../../discovery/src/discovery-score";
import {DISCOVERY_SCORE_POLICY} from "../../../discovery/src/discovery-score-model";
import review from "../../../discovery/fixtures/score-xto-review.json";
import {defaultScoreInputV2,freezeDiscoveryScoreV2,scoreSummaryV2} from "../../../discovery/src/discovery-score-v2";
import {DISCOVERY_SCORE_POLICY_V2} from "../../../discovery/src/discovery-score-v2-model";
import {ScorePriceSchema,ScoreRecordSchema} from "../../../discovery/src/discovery-score-model";
const at=new Date("2026-10-21T01:00:00.000Z");
it("puts the graded score and evidence coverage before binary action status",async()=>{
  const c=(await fixtureCandidates(at))[0]!,record=await freezeDiscoveryScore(defaultScoreInput(c,at)),html=renderToStaticMarkup(<DiscoveryScoreBadge score={scoreSummary(record)} rank={1} />);
  expect(html).toContain("#1 · Discovery score");expect(html).toContain(" / 100");expect(html).toContain("Evidence coverage");expect(html).not.toContain("eligible");
});
it("does not turn unavailable evidence into a scam verdict or an invented zero",()=>{
  const html=renderToStaticMarkup(<DiscoveryScoreBadge score={undefined} />);expect(html).toContain("Score unavailable");expect(html).not.toContain("0 / 100");expect(renderToStaticMarkup(<DiscoveryScorePanel record={null} error="invalid" />)).toContain("could not be verified");
});
it("explains risk ceilings, unknowns, stale display and export of the exact observed score",async()=>{
  const c=(await fixtureCandidates(at))[0]!;c.risk.mint_authority="active";const record=await freezeDiscoveryScore(defaultScoreInput(c,at)),html=renderToStaticMarkup(<DiscoveryScorePanel record={record} error="refresh failed" />);
  for(const text of ["limit this score to 40","mint authority active","Unknown","not a safety probability","previous score may be out of date","Download this scorecard","later refreshes","Scorecard checksum"])expect(html.toLowerCase()).toContain(text.toLowerCase());expect(html).toContain(record.record_hash);
});
it("publishes the fixed weights and distinguishes model maximum from trust and action authority",()=>{
  const html=renderToStaticMarkup(<DiscoveryScoreMethod policy={DISCOVERY_SCORE_POLICY} policyHash={"a".repeat(64)} />);
  for(const text of ["0–100","low score does not establish a scam","model maximum","Missing information earns no points","Separate evidence requirements","Onchain controls","Wallets &amp; funding","scoring policy &amp; thresholds"])expect(html).toContain(text);
});
it("shows the XTO price and sampled trading concerns on both cards and details",async()=>{
  const old=ScoreRecordSchema.parse(review.original),record=await freezeDiscoveryScoreV2(defaultScoreInputV2(old.inputs.candidate,new Date(old.inputs.as_of),ScorePriceSchema.array().parse(review.prices)));
  const badge=renderToStaticMarkup(<DiscoveryScoreBadge score={scoreSummaryV2(record)} />),html=renderToStaticMarkup(<DiscoveryScorePanel record={record}/>);
  for(const text of ["abrupt sampled price move","thin reported depth relative to cap","dust dominated post creation trade sample"])expect(badge).toContain(text);
  for(const text of ["124.90%","0.616%","7 of 7","not all trading","discovery-score-v2","0.01 SOL"])expect(html).toContain(text);
  expect(renderToStaticMarkup(<DiscoveryScoreMethod policy={DISCOVERY_SCORE_POLICY_V2} policyHash={record.policy_hash}/>)).toContain("thresholds remain provisional");
});
