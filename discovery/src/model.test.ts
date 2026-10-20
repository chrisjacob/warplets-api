import { describe, expect, it } from "vitest";
import { fixtureCandidates } from "./fixtures";
import { assess, DEFAULT_POLICY, shortlist, type Candidate } from "./model";
import { toBase58 } from "./solana";

const now = new Date("2026-10-20T00:00:00Z");
const sandbox = { ...DEFAULT_POLICY, require_holder_evidence: false, require_wallet_analysis: false };
describe("eligibility and capped deterministic shortlist", () => {
  it("does not silently waive unavailable holder analysis", async () => {
    expect(assess((await fixtureCandidates(now))[0]!, DEFAULT_POLICY, now)).toMatchObject({ eligibility: "provisional", reasons: ["holder_concentration_unknown", "wallet_analysis_unavailable"], launch_eligible: false });
  });
  it("keeps an old token excluded even with a newly created pool", async () => {
    const old = (await fixtureCandidates(now))[1]!;
    expect(assess(old, sandbox, now).reasons).toContain("token_older_than_24h");
  });
  it("missing graduation and missing cap never qualify, even with FDV", async () => {
    const f = await fixtureCandidates(now);
    expect(assess(f[2]!, sandbox, now).eligibility).toBe("provisional");
    expect(assess(f[3]!, sandbox, now).reasons).toContain("market_cap_unknown_not_fdv");
  });
  it("enforces age boundaries including future timestamps", async () => {
    const c = (await fixtureCandidates(now))[0]!;
    const check = (ms: number) => assess({ ...c, creation: { ...c.creation!, block_time: new Date(now.getTime() - ms).toISOString() } }, sandbox, now);
    expect(check(24 * 3600_000).eligibility).toBe("eligible");
    expect(check(24 * 3600_000 + 1).eligibility).toBe("excluded");
    expect(check(-1).reasons).toContain("creation_in_future");
  });
  it("marks outage snapshots stale rather than resetting their timestamps", async () => {
    const c = (await fixtureCandidates(now))[0]!;
    const row = assess(c, sandbox, new Date(now.getTime() + 900_000));
    expect(row.reasons).toContain("market_data_stale"); expect(row.reasons).toContain("risk_evidence_stale");
    expect(row.market?.fetched_at).toBe(c.market?.fetched_at);
  });
  it("rejects future risk and market observations through the existing freshness gates",async()=>{
    const c=(await fixtureCandidates(now))[0]!,future=new Date(now.getTime()+1000).toISOString();
    expect(assess({...c,risk:{...c.risk,observed_at:future}},sandbox,now)).toMatchObject({eligibility:"provisional",reasons:["risk_evidence_stale"]});
    expect(assess({...c,market:{...c.market!,fetched_at:future}},sandbox,now)).toMatchObject({eligibility:"provisional",reasons:["market_data_stale"]});
    expect(assess({...c,market:{...c.market!,observed_at:future}},sandbox,now)).toMatchObject({eligibility:"provisional",reasons:["market_data_stale"]});
  });
  it("never publishes more than 100 assets or duplicate mints; ranks are stable", async () => {
    const c = (await fixtureCandidates(now))[0]!;
    const rows: Candidate[] = Array.from({ length: 130 }, (_, i) => ({ ...c, address: toBase58(Uint8Array.from({ length: 32 }, (_, n) => n === 0 ? i + 1 : 1)) }));
    const a = shortlist([...rows, ...rows], sandbox, now), b = shortlist([...rows].reverse(), sandbox, now);
    expect(a).toEqual(b); expect(a).toHaveLength(100); expect(new Set(a.map(r => r.address)).size).toBe(100);
    expect(a.map(r => r.rank)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });
  it("separates verification from permissions and economic eligibility", async () => {
    const c = (await fixtureCandidates(now))[0]!;
    const row = assess({ ...c, risk: { ...c.risk, freeze_authority: "active" } }, sandbox, now);
    expect(row.verification).toBe("verified"); expect(row.eligibility).toBe("excluded"); expect(row.rank).toBeNull();
  });
  it("does not bury promising provisional contenders behind a hundred newer exclusions", async()=>{
    const c=(await fixtureCandidates(now))[0]!, rejects=Array.from({length:110},(_,i)=>({...c,address:toBase58(Uint8Array.from({length:32},(_,n)=>n===0?i+1:5)),market:{...c.market!,liquidity_usd:1}}));
    const rows=shortlist([...rejects,c],DEFAULT_POLICY,now);expect(rows[0]?.address).toBe(c.address);expect(rows[0]?.eligibility).toBe("provisional");expect(rows).toHaveLength(100);
  });
});
