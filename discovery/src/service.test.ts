import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { acquire, captureCohort, control, dryRun, reserveQuota, saveCandidate } from "./store";
import { runReviews } from "./research";
import { runMarketCycle } from "./market-cycle";
import { DEFAULT_POLICY } from "./model";
import worker, { handle, type LocalEnv } from "./worker";
import { boundedJson, MAINNET_GENESIS, RpcClient } from "./rpc";
import { runCycle } from "./ingest";
import { gateSample, walletInput } from "./wallet-fixtures.test-helper";
import { reserveWalletQuota, runWalletCycle } from "./wallet-cycle";

const instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); instances.push(db);
  db.exec(readFileSync(new URL("../migrations/0001_discovery.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_account_evidence.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0003_fixture_isolation.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0004_research_history.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0005_wallet_analysis.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0006_wallet_research.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0007_funding_history.sql", import.meta.url), "utf8"));
  const d1 = sqliteD1(db);
  const env: LocalEnv = { TENX_DB: d1, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "3000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  return { db, d1, env };
}
const req = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:8794/api/10x/${path}`, init);
function admin(body: unknown, token = "a".repeat(64)): RequestInit { return { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }; }
describe("durable discovery state and public/admin API", () => {
  it("retains first discovery but measures wallet research from its later immutable baseline", async () => {
    const { d1 } = fixture(), at = new Date("2026-10-18T00:00:00Z"), c = { ...(await fixtureCandidates(at))[0]!, mode: "live" as const }, w = await gateSample();
    await captureCohort(d1, c, at.toISOString());
    const later = "2026-10-18T00:10:00Z", sample = { ...c, wallet_analysis: { ...w, observed_at: later }, market: { ...c.market!, fetched_at: later } };
    await captureCohort(d1, sample, later); await captureCohort(d1, { ...sample, wallet_analysis: { ...sample.wallet_analysis, observed_at: "2026-10-18T00:20:00Z" } }, "2026-10-18T00:20:00Z");
    expect((await d1.prepare("SELECT selected_at FROM tenx_cohorts").first<{ selected_at: string }>())?.selected_at).toBe(at.toISOString());
    expect((await d1.prepare("SELECT selected_at FROM tenx_wallet_cohorts").first<{ selected_at: string }>())?.selected_at).toBe(later);
    await runReviews(d1, new Date("2026-10-19T03:00:00Z"));
    const report = JSON.parse((await d1.prepare("SELECT payload FROM tenx_reviews WHERE day='2026-10-18'").first<{ payload: string }>())!.payload);
    expect(report.outcomes[0]).toMatchObject({ selected_at: later, cohort_kind: "first_wallet_sample", recommended: false, features: { sampled_buyers: 3 } });
  });
  it("timestamps independently refreshed wallet evidence before freezing it for research", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates(new Date("2026-10-20T00:00:00Z")))[0]!, mode: "live" as const }, w = await gateSample();
    await captureCohort(d1, { ...c, wallet_analysis: { ...w, observed_at: "2026-10-20T00:01:00Z" } }, "2026-10-20T00:00:00Z");
    expect((await d1.prepare("SELECT selected_at FROM tenx_cohorts").first<{ selected_at: string }>())?.selected_at).toBe("2026-10-20T00:01:00Z");
  });
  it("collects, persists, exposes and reuses immutable wallet transactions through the complete local pipeline", async () => {
    const { d1, env } = fixture(), input = await walletInput(), base = (await fixtureCandidates())[0]!;
    await saveCandidate(d1, { ...base, mode: "live", creation: input.asset.creation, graduation: null });
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result = body.method === "getGenesisHash" ? MAINNET_GENESIS : body.method === "getTransaction" ? input.records.find(r => r.signature === body.params[0])?.transaction ?? null : body.method === "getSignaturesForAddress" ? body.params[0] === input.histories[0]!.address ? input.records.map(r => ({ signature: r.signature, slot: r.transaction!.slot, blockTime: r.transaction!.blockTime, err: null, confirmationStatus: "finalized" })).reverse() : [] : null;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 80, transport };
    const first = await runWalletCycle(settings, base.address); expect(first).toMatchObject({ state: "succeeded", verified_buys: 3 });
    const before = transport.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).method === "getTransaction").length;
    expect(await runWalletCycle(settings, base.address)).toMatchObject({ state: "succeeded", verified_buys: 3 });
    expect(transport.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).method === "getTransaction")).toHaveLength(before);
    const evidence = await handle(req(`wallet-evidence/${first.evidence_hash}`), env); expect(evidence.status).toBe(200);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_wallet_transactions").first<{ n: number }>())?.n).toBe(4);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_wallet_profiles").first<{ n: number }>())?.n).toBe(4);
  });
  it("preserves newer independent wallet and market snapshots when older chain work completes", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates(new Date("2026-10-20T00:00:00Z")))[0]!, mode: "live" as const }, w = await gateSample();
    const newer = { ...c, wallet_analysis: w, market: { ...c.market!, fetched_at: "2026-10-20T00:01:00Z" } };
    await saveCandidate(d1, newer); await saveCandidate(d1, c);
    const row = JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())!.payload);
    expect(row.wallet_analysis).toEqual(w); expect(row.market.fetched_at).toBe(newer.market.fetched_at);
  });
  it("caps wallet requests atomically inside the global RPC allowance", async () => {
    const { d1 } = fixture(), settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 2, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 3 };
    const reserve = reserveWalletQuota(d1, settings, new Date());
    const result = await Promise.allSettled(Array.from({ length: 10 }, () => reserve()));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect((await d1.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first<{ used: number }>())?.used).toBe(2);
    expect((await d1.prepare("SELECT used FROM tenx_wallet_usage").first<{ used: number }>())?.used).toBe(3);
  });
  it("wallet automation respects pause, source backoff and active leases, including targeted manual refresh", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const }; await saveCandidate(d1, c);
    const transport = vi.fn(), settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: false, walletEnabled: true, walletDailyLimit: 80, transport };
    await d1.prepare("UPDATE tenx_control SET paused=1").run(); expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "paused" });
    await d1.prepare("UPDATE tenx_control SET paused=0").run();
    const later = new Date(Date.now() + 300000).toISOString();
    await d1.prepare("UPDATE tenx_wallet_control SET next_refresh_at=?1,last_error='rpc_rate_limited'").bind(later).run();
    expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "waiting" });
    await d1.prepare("UPDATE tenx_wallet_control SET last_error=NULL,lease_until=?1").bind(later).run();
    expect(await runWalletCycle(settings, c.address)).toMatchObject({ state: "waiting" }); expect(transport).not.toHaveBeenCalled();
  });
  it("wallet public reads are cached and admin wallet collection requires authentication", async () => {
    const { env } = fixture(), transport = vi.spyOn(globalThis, "fetch");
    expect((await handle(req(`wallets/solana/${(await fixtureCandidates())[0]!.address}`), env)).status).toBe(200);
    expect((await handle(req(`wallet-evidence/${"a".repeat(64)}`), env)).status).toBe(404);
    expect((await handle(req("admin/wallet-refresh"), env)).status).toBe(401); expect(transport).not.toHaveBeenCalled();
  });
  it("retains immutable observation and first recommendation snapshots separately", async () => {
    const { d1 } = fixture(), now = new Date("2026-10-20T00:00:00Z"), c = { ...(await fixtureCandidates(now))[0]!, mode: "live" as const };
    await captureCohort(d1, c, now.toISOString());
    const initial = await d1.prepare("SELECT payload,input_hash FROM tenx_cohorts").first();
    const h = { version: "owners-v2" as const, layout_certified: true, status: "verified" as const, observed_at: now.toISOString(), context_slot: 30000, payload_hash: "a".repeat(64), supply_raw: "1000", inventoried_raw: "1000", account_count: 201, holder_count: 200, top1_pct: 1, top10_pct: 10, pool_pct: 50, creator_pct: 0, creator: c.address, owners: [], gaps: [] };
    await captureCohort(d1, { ...c, holders: h, wallet_analysis: await gateSample() }, now.toISOString());
    expect(await d1.prepare("SELECT payload,input_hash FROM tenx_cohorts").first()).toEqual(initial);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_selections").first<{ n: number }>())?.n).toBe(1);
    expect(await d1.prepare("SELECT payload FROM tenx_selections").first()).not.toEqual({ payload: (initial as { payload: string }).payload });
  });
  it("creates idempotent daily report revisions without provider calls and keeps absent outcomes unknown", async () => {
    const { d1, env } = fixture(), prior = new Date("2026-10-18T00:00:00Z"), c = { ...(await fixtureCandidates(prior))[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    await runReviews(d1, new Date("2026-10-19T03:00:00Z")); await runReviews(d1, new Date("2026-10-19T04:00:00Z"));
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_reviews").first<{ n: number }>())?.n).toBe(1);
    const response = await (await handle(req("research/reviews"), env)).json() as { data: { reports: { counts: { measured: number; insufficient_data: number } }[]; automatic_policy_changes: boolean } };
    expect(response.data.reports[0]?.counts).toMatchObject({ measured: 0, insufficient_data: 1 }); expect(response.data.automatic_policy_changes).toBe(false);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_usage").first<{ n: number }>())?.n).toBe(0);
  });
  it("batches market history under a lease, preserves risk data and validates history queries", async () => {
    const { d1, env } = fixture(), now = new Date(), c = { ...(await fixtureCandidates(now))[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    const transport = vi.fn(async () => Response.json({ data: [{ attributes: { address: c.pool, base_token_price_usd: ".002", market_cap_usd: null, fdv_usd: "400000", reserve_in_usd: "50000", volume_usd: { h24: "5000" } }, relationships: { base_token: { data: { id: `solana_${c.address}` } } } }], included: [{ id: `solana_${c.address}`, type: "token", attributes: { image_url: "https://assets.geckoterminal.com/valid" } }] }));
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: true, transport };
    expect(await runMarketCycle(settings, new Date(now.getTime() + 1000))).toMatchObject({ state: "succeeded", updated: 1 });
    expect(await runMarketCycle(settings, new Date(now.getTime() + 2000))).toMatchObject({ state: "waiting" }); expect(transport).toHaveBeenCalledTimes(1);
    const saved = JSON.parse((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())!.payload);
    expect(saved.risk).toEqual(c.risk); expect(saved.checked_at).toBe(c.checked_at); expect(saved.market.image_url).toBe("https://assets.geckoterminal.com/valid");
    const history = await (await handle(req(`history/solana/${c.address}?hours=24`), env)).json() as { data: { points: unknown[] } };
    expect(history.data.points).toHaveLength(2); expect((await worker.fetch(req(`history/solana/${c.address}?hours=999`), env)).status).toBe(400);
  });
  it("paces chain refresh without source calls before the scheduled next tick", async () => {
    const { d1 } = fixture(), now = new Date();
    await d1.prepare("UPDATE tenx_control SET next_refresh_at=?1 WHERE id=1").bind(new Date(now.getTime() + 300000).toISOString()).run();
    const transport = vi.fn();
    expect(await runCycle({ db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 5000, marketDailyLimit: 600, marketEnabled: false, paced: true, transport }, now)).toMatchObject({ state: "waiting" }); expect(transport).not.toHaveBeenCalled();
    expect(DEFAULT_POLICY.version).toBe("discovery-local-v3");
  });
  it("reserves quotas atomically, including concurrent requests", async () => {
    const { d1 } = fixture(), reserve = reserveQuota(d1, { rpc: 3, market: 2 }, new Date());
    const result = await Promise.allSettled(Array.from({ length: 10 }, () => reserve("rpc")));
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(3);
    expect((await d1.prepare("SELECT used FROM tenx_usage WHERE provider='rpc'").first<{ used: number }>())?.used).toBe(3);
  });
  it("permits only one active job lease and respects pause", async () => {
    const { d1 } = fixture(), now = new Date().toISOString();
    expect(await acquire(d1, "one", now)).toBe(true); expect(await acquire(d1, "two", now)).toBe(false);
    await d1.prepare("UPDATE tenx_control SET paused=1,lease_until=NULL WHERE id=1").run();
    expect(await acquire(d1, "three", now)).toBe(false);
  });
  it("does not count fixture data as live or let it win a dry run", async () => {
    const { env, d1 } = fixture();
    for (const c of await fixtureCandidates()) await saveCandidate(d1, c);
    const live = await (await handle(req("candidates"), env)).json() as { data: { candidates: unknown[] } };
    expect(live.data.candidates).toEqual([]);
    const examples = await (await handle(req("candidates?mode=fixture"), env)).json() as { data: { candidates: unknown[] } };
    expect(examples.data.candidates).toHaveLength(4);
    expect(await dryRun(d1, new Date())).toMatchObject({ outcome: "no_eligible_winner", winner_address: null, launch_enabled: false });
  });
  it("preserves independent proofs and deduplicates repeated saves", async () => {
    const { d1 } = fixture(), c = (await fixtureCandidates())[0]!;
    const live = { ...c, mode: "live" as const };
    await saveCandidate(d1, live); await saveCandidate(d1, live);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{ n: number }>())?.n).toBe(1);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_proofs").first<{ n: number }>())?.n).toBe(2);
  });
  it("cannot overwrite a live candidate by seeding the same fixture address", async () => {
    const { d1 } = fixture(), c = (await fixtureCandidates())[0]!;
    await saveCandidate(d1, { ...c, mode: "live", name: "Live name" }); await saveCandidate(d1, c);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_candidates").first<{ n: number }>())?.n).toBe(2);
    expect((await d1.prepare("SELECT payload FROM tenx_candidates WHERE mode='live'").first<{ payload: string }>())?.payload).toContain("Live name");
  });
  it("denies all admin reads/writes without the local operator token", async () => {
    const { env } = fixture();
    for (const path of ["jobs", "refresh", "pause", "dry-run", "seed-fixtures", "policies/preview"]) {
      expect((await handle(req(`admin/${path}`, path === "jobs" ? undefined : admin({ reason: "test" }, "wrong")), env)).status).toBe(401);
    }
    expect((await handle(req("admin/jobs", { headers: { authorization: `Bearer ${env.TENX_ADMIN_TOKEN}` } }), env)).status).toBe(200);
  });
  it("rejects cross-origin admin writes and remote runtime hosts", async () => {
    const { env } = fixture();
    const init = admin({ reason: "test pause", paused: true });
    (init.headers as Record<string, string>).origin = "https://evil.example";
    expect((await handle(req("admin/pause", init), env)).status).toBe(403);
    expect((await handle(new Request("https://deployed.example/api/10x/candidates"), env)).status).toBe(503);
    expect((await handle(req("candidates"), { ...env, TENX_LOCAL_ONLY: "false" })).status).toBe(503);
  });
  it("validates pagination and expires a cursor against a changed snapshot", async () => {
    const { env, d1 } = fixture(); for (const c of await fixtureCandidates()) await saveCandidate(d1, c);
    expect((await worker.fetch(req("candidates?limit=101"), env)).status).toBe(400);
    expect((await worker.fetch(req("candidates?cursor=not-base64"), env)).status).toBe(400);
    const first = await (await handle(req("candidates?mode=fixture&limit=2"), env)).json() as { next_cursor: string; data: { candidates: { address: string }[] } };
    const second = await (await handle(req(`candidates?mode=fixture&limit=2&cursor=${encodeURIComponent(first.next_cursor)}`), env)).json() as { data: { candidates: { address: string }[] } };
    expect(new Set([...first.data.candidates, ...second.data.candidates].map(c => c.address)).size).toBe(4);
    const c = (await fixtureCandidates())[0]!; c.name = "changed snapshot"; await saveCandidate(d1, c);
    expect((await handle(req(`candidates?mode=fixture&cursor=${encodeURIComponent(first.next_cursor)}`), env)).status).toBe(409);
  });
  it("persists pause reason and never enables financial capabilities", async () => {
    const { env, d1 } = fixture();
    expect((await handle(req("admin/pause", admin({ reason: "test maintenance", paused: true })), env)).status).toBe(200);
    expect((await control(d1)).paused).toBe(1);
    expect((await d1.prepare("SELECT reason FROM tenx_audit").first<{ reason: string }>())?.reason).toBe("test maintenance");
    const status = await (await handle(req("system/status"), env)).json() as { data: { capabilities: Record<string, boolean> } };
    expect(status.data.capabilities).toMatchObject({ voting: false, launches: false, signing: false, rewards: false });
  });
  it("retains last-good candidates and backs off after a provider outage", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    const result = await runCycle({ db: d1, rpcUrl: "https://api.mainnet-beta.solana.com", rpcDailyLimit: 20, marketDailyLimit: 20, marketEnabled: false, transport: async () => { throw new Error("offline"); } });
    expect(result).toMatchObject({ state: "failed", error_code: "rpc_unavailable" });
    expect((await d1.prepare("SELECT payload FROM tenx_candidates").first<{ payload: string }>())?.payload).toBe(JSON.stringify(c));
    expect((await control(d1)).retry_after).not.toBeNull(); expect((await control(d1)).lease_owner).toBeNull();
  });
  it("processes a replayed lead end to end, stores both proofs, and ignores duplicate job delivery", async () => {
    const { d1 } = fixture(), b = await syntheticBundle(), now = new Date("2026-10-20T00:00:00Z");
    await d1.prepare("UPDATE tenx_control SET last_harvest=?1 WHERE id=1").bind(now.toISOString()).run();
    await d1.prepare("INSERT INTO tenx_leads(address,pool,migration_tx,migration_signature,first_seen_at) VALUES(?1,?2,?3,?4,?5)")
      .bind(b.mint, b.pool, JSON.stringify(b.graduation), b.graduation.transaction.signatures[0]!, now.toISOString()).run();
    const transport = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result = body.method === "getGenesisHash" ? MAINNET_GENESIS : body.method === "getSignaturesForAddress" ? [{ signature: b.creation.transaction.signatures[0], slot: b.creation.slot, err: null, blockTime: b.creation.blockTime, confirmationStatus: "finalized" }] : body.method === "getTransaction" ? b.creation : b.accounts;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    });
    const settings = { db: d1, rpcUrl: "https://rpc.example", rpcDailyLimit: 100, marketDailyLimit: 10, marketEnabled: false, transport };
    expect(await runCycle(settings, now)).toMatchObject({ state: "succeeded", processed: 1 });
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_proofs").first<{ n: number }>())?.n).toBe(2);
    expect((await d1.prepare("SELECT count(*) AS n FROM tenx_evidence").first<{ n: number }>())?.n).toBe(2);
    const calls = transport.mock.calls.length;
    expect(await runCycle(settings, now)).toMatchObject({ state: "duplicate" }); expect(transport).toHaveBeenCalledTimes(calls);
  });
  it("rejects an attempt to replace an immutable proof", async () => {
    const { d1 } = fixture(), c = { ...(await fixtureCandidates())[0]!, mode: "live" as const };
    await saveCandidate(d1, c);
    await expect(saveCandidate(d1, { ...c, creation: { ...c.creation!, payload_hash: "f".repeat(64) } })).rejects.toThrow("conflicting_immutable_proof");
  });
});
describe("bounded read-only RPC adapter", () => {
  it("checks mainnet identity and uses finalized commitment/version limits", async () => {
    const bundle = await syntheticBundle(); const calls: { method: string; params: unknown[]; id: number }[] = [];
    const rpc = new RpcClient("https://api.mainnet-beta.solana.com", async () => {}, async (_url, init) => {
      expect(init?.redirect).toBe("manual");
      const body = JSON.parse(String(init?.body)); calls.push(body);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "getGenesisHash" ? MAINNET_GENESIS : bundle.creation });
    });
    await rpc.checkCluster(); await rpc.transaction(bundle.creation.transaction.signatures[0]!);
    expect(calls[1]?.params[1]).toEqual({ commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 });
  });
  it("fails closed for a wrong cluster, signature mismatch, and unsupported versions", async () => {
    const b = await syntheticBundle();
    const rpc = new RpcClient("https://rpc.example", async () => {}, async (_url, init) => Response.json({ jsonrpc: "2.0", id: JSON.parse(String(init?.body)).id, result: "devnet" }));
    await expect(rpc.checkCluster()).rejects.toThrow("wrong_solana_cluster");
    const r2 = new RpcClient("https://rpc.example", async () => {}, async () => Response.json({ jsonrpc: "2.0", id: 1, result: b.creation }));
    await expect(r2.transaction(b.graduation.transaction.signatures[0]!)).rejects.toThrow("transaction_signature_mismatch");
    const r3 = new RpcClient("https://rpc.example", async () => {}, async () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32015 } }));
    await expect(r3.transaction(b.creation.transaction.signatures[0]!)).rejects.toThrow("unsupported_transaction_version");
  });
  it("does not retry 429s or exceed its cycle budget", async () => {
    const reserve = vi.fn(), transport = vi.fn(async () => new Response("limited", { status: 429 }));
    const rpc = new RpcClient("https://rpc.example", reserve, transport, 1);
    await expect(rpc.checkCluster()).rejects.toThrow("rpc_rate_limited");
    await expect(rpc.checkCluster()).rejects.toThrow("cycle_rpc_budget_exhausted");
    expect(transport).toHaveBeenCalledTimes(1); expect(reserve).toHaveBeenCalledTimes(1);
  });
  it("cancels oversized streams before parsing", async () => {
    await expect(boundedJson(new Response("x".repeat(200)), 100)).rejects.toThrow("response_too_large");
  });
});
