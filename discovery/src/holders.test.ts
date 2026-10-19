import { describe, expect, it } from "vitest";
import { analyzeHolders, type HolderEvidence } from "./holders";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { migrations, TOKEN } from "./pump";
import { publicKey, toBase58 } from "./solana";
import { assess, DEFAULT_POLICY } from "./model";
import { readFileSync } from "node:fs";
import { HolderEvidenceSchema } from "./holders";
import { HolderSchema } from "./holder-model";

const now = new Date("2026-10-20T00:00:00Z"), key = (n: number) => toBase58(new Uint8Array(32).fill(n));
function tokenAccount(address: string, owner: string, mint: string, amount: bigint) {
  const bytes = new Uint8Array(165); bytes.set(publicKey(mint)); bytes.set(publicKey(owner), 32); new DataView(bytes.buffer).setBigUint64(64, amount, true); bytes[108] = 1;
  return { pubkey: address, account: { owner: TOKEN, executable: false, space: 165, data: [btoa(String.fromCharCode(...bytes)), "base64"] as [string, "base64"] } };
}
async function evidence(): Promise<HolderEvidence> {
  const b = await syntheticBundle(now), m = (await migrations(b.graduation))[0]!;
  return { mint: b.mint, pool: b.pool, program: TOKEN, creator: key(1), inventory: { context: { slot: 30000 }, value: [
    ...Array.from({ length: 120 }, (_, n) => tokenAccount(key(n + 1), key(n + 1), b.mint, 5_000_000n)),
    tokenAccount(m.baseVault, b.pool, b.mint, 400_000_000n),
  ] }, mint_state: { context: { slot: 30001 }, value: [b.accounts.value[0]!] } };
}
describe("supply-reconciled token-owner concentration", () => {
  it("replays a real finalized owner inventory against its saved hash and expected concentration", async () => {
    const record = JSON.parse(readFileSync(new URL("../fixtures/recorded/holder-evidence.json", import.meta.url), "utf8"));
    const e = HolderEvidenceSchema.parse(record.evidence);
    const actual = await analyzeHolders(e, record.expected.observed_at);
    expect(actual).toEqual(HolderSchema.parse(record.expected)); expect(actual.version).toBe("owners-v2"); expect(actual.status).toBe("verified"); expect(actual.layout_certified).toBe(true);
  });
  it("reconciles bigint supply, exempts only canonical vault and permits an evidence-complete holder gate", async () => {
    const e = await evidence(), h = await analyzeHolders(e, now.toISOString());
    expect(h).toMatchObject({ status: "verified", holder_count: 120, account_count: 121, top1_pct: .5, top10_pct: 5, pool_pct: 40, creator_pct: .5, inventoried_raw: "1000000000" });
    const c = (await fixtureCandidates(now))[0]!;
    expect(assess({ ...c, holders: h, risk: { ...c.risk, holder_concentration: "verified" } }, { ...DEFAULT_POLICY, require_wallet_analysis: false }, now).eligibility).toBe("eligible");
  });
  it("aggregates split accounts under one owner instead of diluting concentration", async () => {
    const e = await evidence();
    e.inventory.value[1] = tokenAccount(key(2), key(1), e.mint, 5_000_000n);
    const h = await analyzeHolders(e, now.toISOString()); expect(h.holder_count).toBe(119); expect(h.top1_pct).toBe(1); expect(h.creator_pct).toBe(1);
  });
  it("does not exempt an unknown pool, custody or off-curve owner", async () => {
    const e = await evidence();
    for (let n = 0; n < 25; n++) e.inventory.value[n] = tokenAccount(key(n + 1), key(200), e.mint, 5_000_000n);
    const h = await analyzeHolders(e, now.toISOString()); expect(h.top1_pct).toBe(12.5);
    expect(assess({ ...(await fixtureCandidates(now))[0]!, holders: h }, DEFAULT_POLICY, now).reasons).toContain("top_holder_concentration_high");
  });
  it("partial supply coverage cannot pass even when known concentrations are small", async () => {
    const e = await evidence(); e.inventory.value.shift(); const h = await analyzeHolders(e, now.toISOString()); expect(h.status).toBe("partial");
    const row = assess({ ...(await fixtureCandidates(now))[0]!, holders: h }, DEFAULT_POLICY, now); expect(row.eligibility).toBe("provisional"); expect(row.reasons).toContain("holder_concentration_unknown");
  });
  it("blocks stale inventories, unknown creation user and too few owners", async () => {
    const e = await evidence(), c = (await fixtureCandidates(now))[0]!;
    e.creator = null; const h = await analyzeHolders(e, now.toISOString());
    expect(assess({ ...c, holders: h }, DEFAULT_POLICY, now).reasons).toContain("creator_holdings_unknown");
    expect(assess({ ...c, holders: { ...h, creator_pct: 0, observed_at: new Date(now.getTime() - 1801000).toISOString() } }, DEFAULT_POLICY, now).reasons).toContain("holder_evidence_stale");
    e.inventory.value = [tokenAccount(e.inventory.value.at(-1)!.pubkey, e.pool, e.mint, 1_000_000_000n)];
    expect(assess({ ...c, holders: await analyzeHolders(e, now.toISOString()) }, DEFAULT_POLICY, now).reasons).toContain("too_few_holders");
  });
  it("rejects duplicate accounts, oversupply, mismatched mints/owners and stale context", async () => {
    let e = await evidence(); e.inventory.value.push(e.inventory.value[0]!); await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("invalid_holder_account");
    e = await evidence(); e.inventory.value[0] = tokenAccount(key(1), key(1), e.mint, 1_000_000_000n); await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("holder_supply_exceeded");
    e = await evidence(); e.inventory.value[0] = tokenAccount(key(1), key(1), key(7), 5_000_000n); await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("holder_mint_mismatch");
    e = await evidence(); e.inventory.value[0]!.account.owner = key(9); await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("invalid_holder_account");
    e = await evidence(); e.inventory.value[0]!.account.space = 355; await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("invalid_holder_account_size");
    e = await evidence(); e.mint_state.context.slot += 151; await expect(analyzeHolders(e, now.toISOString())).rejects.toThrow("holder_context_mismatch");
  });
  it("keeps mintable supply partial", async () => {
    const e = await evidence(), data = Uint8Array.from(atob(e.mint_state.value[0]!.data[0]), c => c.charCodeAt(0)); data[0] = 1;
    e.mint_state.value[0]!.data[0] = btoa(String.fromCharCode(...data));
    expect((await analyzeHolders(e, now.toISOString())).status).toBe("partial");
  });
  it("rounds concentration conservatively and refuses legacy-prefix evidence for eligibility", async () => {
    const e = await evidence();
    e.inventory.value[0] = tokenAccount(key(1), key(1), e.mint, 100_000_001n);
    const vault = e.inventory.value.at(-1)!; e.inventory.value[e.inventory.value.length - 1] = tokenAccount(vault.pubkey, e.pool, e.mint, 304_999_999n);
    const h = await analyzeHolders(e, now.toISOString()); expect(h.top1_pct).toBe(10.000001);
    expect(assess({ ...(await fixtureCandidates(now))[0]!, holders: h }, DEFAULT_POLICY, now).reasons).toContain("top_holder_concentration_high");
    const legacy = await evidence(); legacy.inventory.value.forEach(row => { row.account.data[0] = btoa(atob(row.account.data[0]).slice(0, 109)); });
    const replay = await analyzeHolders(legacy, now.toISOString()); expect(replay.version).toBe("owners-v1");
    expect(assess({ ...(await fixtureCandidates(now))[0]!, holders: replay }, DEFAULT_POLICY, now).reasons).toContain("holder_concentration_unknown");
  });
});
