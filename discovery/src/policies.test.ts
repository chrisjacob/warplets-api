import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates } from "./fixtures";
import { DEFAULT_POLICY, assess, type Candidate } from "./model";
import { gateSample } from "./wallet-fixtures.test-helper";
import { saveCandidate } from "./store";
import { assertTighterPolicy, createPolicyPreview, policyPreviewRecord, publicPolicy, replayPolicyPreview } from "./policies";
import { PreviewRequestSchema } from "./policy-model";
import worker, { type LocalEnv } from "./worker";

const at = new Date("2026-10-20T00:00:00Z"), opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(d => d.close()); vi.restoreAllMocks(); });
function database() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
async function eligible(): Promise<Candidate> {
  const c = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const, wallet_analysis: await gateSample() };
  return { ...c, holders: { version: "owners-v2", layout_certified: true, status: "verified", observed_at: at.toISOString(), context_slot: 30000, payload_hash: "b".repeat(64), supply_raw: "1000", inventoried_raw: "1000", account_count: 150, holder_count: 149, top1_pct: 2, top10_pct: 10, creator_pct: 1, pool_pct: 20, creator: c.address, owners: [], gaps: [] } };
}
const request = (edits: object = { min_liquidity_usd: 75000 }) => ({ request_id: crypto.randomUUID(), reason: "Compare deeper liquidity", edits });
describe("local policy transparency and immutable stricter previews", () => {
  it("publishes the actual local policy and keeps review signals distinct", async () => {
    const p = await publicPolicy();
    expect(p).toMatchObject({ policy: DEFAULT_POLICY, approved_by: null, activation_enabled: false });
    expect(p.policy_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(p.diagnostics.every(d => d.classification === "review_only")).toBe(true);
  });
  it("compares the same evidence/time, saves a replayable snapshot, and never changes active gates", async () => {
    const { db } = database(), c = await eligible(); expect(assess(c, DEFAULT_POLICY, at).eligibility).toBe("eligible");
    await saveCandidate(db, c); await saveCandidate(db, { ...c, mode: "fixture", name: "Ignore simulation" });
    const before = JSON.stringify(await db.prepare("SELECT * FROM tenx_candidates ORDER BY mode").all()), calls = vi.spyOn(globalThis, "fetch");
    const r = await createPolicyPreview(db, request(), at);
    expect(r.inputs.baseline.candidates).toHaveLength(1);
    expect(r.result.baseline.counts.eligible).toBe(1); expect(r.result.proposed.counts.eligible).toBe(0);
    expect(r.result.changed[0]).toMatchObject({ before: "eligible", after: "excluded", added_reasons: ["liquidity_below_threshold"] });
    expect(r.result).toMatchObject({ activated: false, provider_requests: 0 });
    expect(await replayPolicyPreview(r)).toEqual(r); expect(await policyPreviewRecord(db, r.id)).toEqual(r);
    expect(JSON.stringify(await db.prepare("SELECT * FROM tenx_candidates ORDER BY mode").all())).toBe(before);
    expect(DEFAULT_POLICY.require_wallet_analysis).toBe(true); expect(calls).not.toHaveBeenCalled();
  });
  it("retries the same request once, preserves frozen inputs after market changes and rejects ID reuse", async () => {
    const { db } = database(), c = await eligible(), req = request(); await saveCandidate(db, c);
    const first = await createPolicyPreview(db, req, at);
    await saveCandidate(db, { ...c, market: { ...c.market!, liquidity_usd: 90000 } });
    expect(await createPolicyPreview(db, req, new Date(at.getTime() + 3600000))).toEqual(first);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_policy_previews").first()).toMatchObject({ n: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_audit WHERE action='policy_preview'").first()).toMatchObject({ n: 1 });
    await expect(createPolicyPreview(db, { ...req, edits: { min_liquidity_usd: 100000 } }, at)).rejects.toThrow("policy_preview_request_conflict");
    const tampered = structuredClone(first); tampered.result.proposed.counts.eligible++;
    await expect(replayPolicyPreview(tampered)).rejects.toThrow("policy_preview_replay_mismatch");
    await db.prepare("UPDATE tenx_policy_previews SET metadata=json_set(metadata,'$.reason','changed') WHERE id=?1").bind(first.id).run();
    await expect(policyPreviewRecord(db, first.id)).rejects.toThrow("policy_preview_replay_mismatch");
  });
  it("locks all evidence/freshness requirements and rejects relaxed numeric limits", async () => {
    const { db } = database();
    for (const edit of [{ min_liquidity_usd: 0 }, { max_top1_pct: 99 }, { min_holders: 1 }, { min_sampled_buyers: 1 }]) await expect(createPolicyPreview(db, request(edit), at)).rejects.toThrow("cannot_relax");
    expect(() => PreviewRequestSchema.parse(request({ require_wallet_analysis: false }))).toThrow();
    expect(() => PreviewRequestSchema.parse(request({ max_market_age_seconds: 999999 }))).toThrow();
    expect(() => assertTighterPolicy({ ...DEFAULT_POLICY, require_holder_evidence: false }, DEFAULT_POLICY)).toThrow("gates_locked");
    expect(() => assertTighterPolicy({ ...DEFAULT_POLICY, max_wallet_age_seconds: 999999 }, DEFAULT_POLICY)).toThrow("gates_locked");
    const c = await eligible(); await saveCandidate(db, { ...c, wallet_analysis: null, holders: null });
    const preview = await createPolicyPreview(db, request({ min_liquidity_usd: 30000 }), at);
    expect(preview.result.proposed.counts.eligible).toBe(0);
    expect(preview.result.proposed.candidates[0]!.reasons).toContain("wallet_analysis_unavailable");
  });
  it("atomically caps new previews per UTC day while retries remain available", async () => {
    const { db } = database(), req = request(); const first = await createPolicyPreview(db, req, at);
    for (let i = 1; i < 20; i++) await createPolicyPreview(db, request(), at);
    await expect(createPolicyPreview(db, request(), at)).rejects.toThrow("daily_limit");
    expect(await createPolicyPreview(db, req, at)).toEqual(first);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM tenx_audit WHERE action='policy_preview'").first()).toMatchObject({ n: 20 });
    await expect(createPolicyPreview(db, request(), new Date(at.getTime() + 86400000))).resolves.toBeTruthy();
  });
  it("rejects oversized inventories instead of silently truncating them", async () => {
    const { db } = database(), c = await eligible();
    for (let i = 0; i < 501; i++) await db.prepare("INSERT INTO tenx_candidates(address,pool,payload,mode,checked_at) VALUES(?1,?2,?3,'live',?4)").bind(`mint-${i}`, c.pool, JSON.stringify(c), at.toISOString()).run();
    await expect(createPolicyPreview(db, request(), at)).rejects.toThrow("inventory_limit");
  });
  it("protects preview reads/writes, validates bodies/origins and exposes no activation route", async () => {
    const { db } = database(), env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_NODE_RELAY: "false", TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "5000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "dexscreener", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
    const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/${path}`, init), env);
    const post = (body: unknown, origin = "https://app-local.10x.meme") => ({ method: "POST", headers: { authorization: `Bearer ${env.TENX_ADMIN_TOKEN}`, "content-type": "application/json", origin }, body: JSON.stringify(body) });
    expect((await call("admin/policies/preview", { method: "POST" })).status).toBe(401);
    expect((await call(`admin/policies/previews/${crypto.randomUUID()}`)).status).toBe(401);
    expect((await call("admin/policies/preview", post(request(), "https://evil.example"))).status).toBe(403);
    expect((await call("admin/policies/preview", post(request({ require_holder_evidence: false })))).status).toBe(400);
    expect((await call("admin/policies/activate", post({ reason: "Never activate" }))).status).toBe(404);
    const response = await call("admin/policies/preview", post(request())); expect(response.status).toBe(200);
    const result = await response.json() as { record: { id: string } };
    expect((await call(`admin/policies/previews/${result.record.id}`, { headers: { authorization: `Bearer ${env.TENX_ADMIN_TOKEN}` } })).status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
