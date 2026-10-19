import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates, syntheticBundle } from "./fixtures";
import { acquire, control, dryRun, reserveQuota, saveCandidate } from "./store";
import worker, { handle, type LocalEnv } from "./worker";
import { boundedJson, MAINNET_GENESIS, RpcClient } from "./rpc";
import { runCycle } from "./ingest";

const instances: DatabaseSync[] = [];
afterEach(() => { instances.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const db = new DatabaseSync(":memory:"); instances.push(db);
  db.exec(readFileSync(new URL("../migrations/0001_discovery.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_account_evidence.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0003_fixture_isolation.sql", import.meta.url), "utf8"));
  const d1 = sqliteD1(db);
  const env: LocalEnv = { TENX_DB: d1, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "3000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_ENABLED: "false" };
  return { db, d1, env };
}
const req = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:8794/api/10x/${path}`, init);
function admin(body: unknown, token = "a".repeat(64)): RequestInit { return { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }; }
describe("durable discovery state and public/admin API", () => {
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
