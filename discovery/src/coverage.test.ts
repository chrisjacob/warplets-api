import { describe, expect, it } from "vitest";
import { fixtureCandidates } from "./fixtures";
import { DEFAULT_POLICY } from "./model";
import { discoveryCoverage } from "./coverage";
const at=new Date("2026-10-20T00:00:00Z");
describe("eligibility target reports evidence rather than filling a quota",()=>{
  it("does not turn ten incomplete tokens into ten eligible tokens",async()=>{
    const c=(await fixtureCandidates(at))[0]!, result=discoveryCoverage(Array(10).fill(c),DEFAULT_POLICY,at);
    expect(result).toMatchObject({target:10,eligible:0,created_24h:10,market_floor_met:10,holder_checks_met:0,remaining:10});expect(result.blockers).toContainEqual({code:"holder_concentration_unknown",count:10});
  });
  it("excludes old or unknown creation and stale market data from stage counts",async()=>{
    const f=await fixtureCandidates(at),result=discoveryCoverage([f[0]!,f[1]!,{...f[0]!,creation:null}],DEFAULT_POLICY,new Date(at.getTime()+300000));
    expect(result).toMatchObject({observed:3,created_24h:1,creation_unknown:1,market_floor_met:0,eligible:0});
  });
});
