import { describe, expect, it } from "vitest";
import { fixtureCandidates } from "./fixtures";
import { assess, DEFAULT_POLICY } from "./model";
import { measureOutcome, proposeRules, walletWatch } from "./research";
import { safeTokenImage } from "./images";

const selected = new Date("2026-10-18T00:00:00Z"), dayLater = new Date("2026-10-19T00:00:00Z");
async function cohort() { const c = (await fixtureCandidates(selected))[0]!; return { candidate: assess(c, DEFAULT_POLICY, selected), policy: DEFAULT_POLICY, selected_at: selected.toISOString() }; }
describe("immutable-baseline outcome research", () => {
  it("measures later returns and liquidity loss without changing the baseline or asserting fraud", async () => {
    const input = await cohort(), before = JSON.stringify(input), base = input.candidate.market!;
    const row = measureOutcome(input, [{ ...base, fetched_at: dayLater.toISOString(), price_usd: .0001, liquidity_usd: 0 }], "frozen", dayLater);
    expect(row).toMatchObject({ status: "measured", return_24h_pct: -90, liquidity_change_pct: -100, outcome: "severe_loss_signal", recommended: false });
    expect(row.features.fees_produced_usd).toBeNull(); expect(row.features.bundle_risk).toBe("unknown"); expect(JSON.stringify(input)).toBe(before);
  });
  it("never invents endpoints, fills stale baselines or uses future observations", async () => {
    const c = await cohort(), base = c.candidate.market!;
    expect(measureOutcome(c, [], "h", dayLater).status).toBe("insufficient_data");
    expect(measureOutcome(c, [{ ...base, fetched_at: dayLater.toISOString() }], "h", selected).status).toBe("pending");
    c.candidate.market = { ...base, fetched_at: "2026-10-17T00:00:00Z" };
    expect(measureOutcome(c, [{ ...base, fetched_at: dayLater.toISOString() }], "h", dayLater).return_24h_pct).toBeNull();
  });
  it("does not optimize thresholds with too few outcomes and never activates a proposal", async () => {
    const c = await cohort(), base = c.candidate.market!;
    const row = measureOutcome(c, [{ ...base, fetched_at: dayLater.toISOString(), price_usd: 0 }], "h", dayLater);
    expect(proposeRules([row])).toEqual([]);
    const rows = Array.from({ length: 50 }, (_, n) => ({ ...row, address: `token-${n}`, selected_at: new Date(selected.getTime() + n * 1000).toISOString(), features: { ...row.features, top1_pct: n % 2 ? 20 : 1, liquidity_usd: n % 2 ? 1000 : 100000 }, outcome: n % 2 ? "severe_loss_signal" as const : "positive" as const }));
    const proposals = proposeRules(rows); expect(proposals.length).toBeGreaterThan(0); expect(proposals.every(p => p.activated === false && p.validation_count === 15)).toBe(true);
    // A predictive pattern in training alone does not justify a holdout proposal.
    rows.slice(35).forEach(r => { r.outcome = "positive"; }); expect(proposeRules(rows)).toEqual([]);
  });
  it("counts distinct token associations across days, without asserting fraud or banning wallets", async () => {
    const c = await cohort(), base = c.candidate.market!;
    const outcome = measureOutcome(c, [{ ...base, fetched_at: dayLater.toISOString(), price_usd: 0 }], "h", dayLater);
    const a = { ...outcome, wallets: [{ wallet: c.candidate.address, role: "creation_user" as const, evidence_hash: "a".repeat(64) }] };
    expect(walletWatch([a, a])).toEqual([]);
    expect(walletWatch([a, { ...a, address: "other-token" }])[0]).toMatchObject({ distinct_tokens: 2, severe_loss_associations: 2, label: "review_association_not_fraud_finding" });
  });
});
describe("token images are untrusted provider metadata", () => {
  it("permits known public image hosts and rejects local, credentialed and executable URLs", () => {
    expect(safeTokenImage("https://assets.geckoterminal.com/public-image")).toBeTruthy();
    for (const value of ["http://127.0.0.1/x", "https://localhost/x", "https://assets.geckoterminal.com@evil.example/x", "data:image/svg+xml,x", "javascript:alert(1)", "https://assets.geckoterminal.com:8794/x", "https://user:password@assets.geckoterminal.com/x"]) expect(safeTokenImage(value)).toBeNull();
  });
});
