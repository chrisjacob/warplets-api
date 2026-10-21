import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {HolderParticipationCell} from "./HolderParticipation";
import {participationFixture} from "../../../discovery/src/holder-participation-fixtures.test-helper";
import {reviewHolderParticipation,unavailableHolderParticipation} from "../../../discovery/src/holder-participation";
import {acquisitionInput} from "../../../discovery/src/holder-acquisition-fixtures.test-helper";
it("shows actual acquired/retained sample denominator, fixed rules and source identity without population credit",async()=>{
  const report=await reviewHolderParticipation(await participationFixture()),html=renderToStaticMarkup(<HolderParticipationCell report={report} window="since_first"/>);
  for(const text of ["1 screened retained · sample","1 supported signed net-buy entrants / 1 raw entrants","0.01 SOL","30 minutes","not fraud labels","Meaningful 24h growth remains unknown","no score credit",report.policy_hash,report.acquisition_hash!])expect(html).toContain(text);
  expect(html).not.toContain("guaranteed");
});
it("keeps known sample zero distinct from missing acquisition evidence and labels stale measurements",async()=>{
  const inputs=await participationFixture(),report=await reviewHolderParticipation(inputs),zero=renderToStaticMarkup(<HolderParticipationCell report={report} window="recent"/>);expect(zero).toContain("0 screened retained · sample");
  const held=await reviewHolderParticipation(await acquisitionInput(inputs.history,null)),missing=renderToStaticMarkup(<HolderParticipationCell report={held} window="since_first"/>);expect(missing).toContain("Unknown");expect(missing).not.toContain("0 screened retained");expect(missing).toContain("held");
  inputs.history.cutoff_at="2026-10-21T10:05:00.000Z";const stale=await reviewHolderParticipation(inputs);expect(renderToStaticMarkup(<HolderParticipationCell report={stale} window="since_first"/>)).toContain("stale");
});
it("labels unavailable, rejected, simulation and legacy comparisons without fabricated counts",async()=>{
  const input=await participationFixture();for(const state of ["missing","rejected","simulation"] as const){const report=await unavailableHolderParticipation(input.history.address,new Date(input.history.cutoff_at),state,"no_source"),html=renderToStaticMarkup(<HolderParticipationCell report={report} window="since_first"/>);expect(html).toContain("Unknown");expect(html).not.toContain("0 screened retained");if(state==="simulation")expect(html).toContain("Simulation");if(state==="rejected")expect(html).toContain("rejected");}
  expect(renderToStaticMarkup(<HolderParticipationCell report={undefined} window="recent"/>)).toContain("Comparable saved inventories unavailable");
});
