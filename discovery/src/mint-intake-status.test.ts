import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import worker, { type LocalEnv } from "./worker";
import { mintIntakeStatus } from "./mint-intake-status";
import { MINT_REVIEW_LIMITS } from "./mint-review-model";
import { key, signature } from "./wallet-fixtures.test-helper";
const databases: DatabaseSync[] = [], at = new Date("2026-10-23T00:00:00.000Z"), address = key(31);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(at); });
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); vi.useRealTimers(); });
function source() {
  const sqlite = new DatabaseSync(":memory:"); databases.push(sqlite);
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  return { sqlite, db: sqliteD1(sqlite) };
}
function review(sqlite: DatabaseSync, state = "scanning", mint = address) {
  sqlite.prepare("INSERT INTO tenx_mint_reviews(address,request_id,curve,state,queued_at,updated_at,pages,last_error) VALUES(?,?,?,?,?,?,?,?)")
    .run(mint, crypto.randomUUID(), key(32), state, "2026-10-22T23:00:00.000Z", "2026-10-22T23:30:00.000Z", 1, "rpc_rate_limited");
}
it("reads one exact indexed metadata projection with no source calls, writes or record-body transfer", async () => {
  const { sqlite, db } = source(); review(sqlite); review(sqlite, "admitted", key(33));
  sqlite.prepare("INSERT INTO tenx_mint_review_reads(address,signature,slot,outcome,payload_hash,observed_at) VALUES(?,?,?,?,?,?)").run(address, signature(30), 123, "not_target_migration", null, at.toISOString());
  sqlite.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(address, key(32), "corrupt oversized body ".repeat(100000), at.toISOString(), "live");
  sqlite.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('mint_intake',?,20)").run(at.toISOString().slice(0, 10));
  const before = sqlite.prepare("SELECT total_changes() n").get()!.n, fetcher = vi.spyOn(globalThis, "fetch"), prepare = vi.spyOn(db, "prepare");
  const result = await mintIntakeStatus(db, address, at);
  expect(result).toMatchObject({ address, candidate_saved: true, migration_lead_saved: false, review: { state: "scanning", pages: 1, bodies_checked: 1 }, control: { reserved_today: 20 }, provider_requests: 0, database_writes: 0, scoring_effect: "none" });
  expect(JSON.stringify(result)).not.toContain("corrupt oversized body"); expect(prepare).toHaveBeenCalledTimes(1);
  const sql = prepare.mock.calls[0]![0]; expect(sql).not.toMatch(/\bpayload\b/i);
  const plan = sqlite.prepare("EXPLAIN QUERY PLAN " + sql).all(address, at.toISOString().slice(0, 10));
  expect(plan.map(row => row.detail).join(" ")).not.toMatch(/SCAN (?:r|b|c|l|u)\b/);
  expect(sqlite.prepare("SELECT total_changes() n").get()!.n).toBe(before); expect(fetcher).not.toHaveBeenCalled();
  expect(MINT_REVIEW_LIMITS).toMatchObject({ pages: 3, page_size: 30, rpc_daily_subset: 20 });
});
it.each(["queued", "scanning", "admitted", "unsupported_quote", "not_found", "expired"])("reports %s without promoting a candidate or proof claim", async state => {
  const { sqlite, db } = source(); review(sqlite, state);
  expect(await mintIntakeStatus(db, address, at)).toMatchObject({ review: { state }, candidate_saved: false, migration_lead_saved: false, evidence_gates_changed: false });
});
it("keeps an unrequested identity distinct from another token and from a fixture record", async () => {
  const { sqlite, db } = source(); review(sqlite, "expired", key(33));
  sqlite.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES(?,?,?,?,?)").run(address, key(32), "{}", at.toISOString(), "fixture");
  expect(await mintIntakeStatus(db, address, at)).toMatchObject({ review: null, candidate_saved: false, migration_lead_saved: false });
});
it.each(["future", "unsafe_error", "overflow"])("fails closed on corrupt %s metadata", async kind => {
  const { sqlite, db } = source(); review(sqlite);
  if (kind === "future") sqlite.prepare("UPDATE tenx_mint_reviews SET updated_at=?").run("2026-10-24T00:00:00.000Z");
  if (kind === "unsafe_error") sqlite.exec("UPDATE tenx_mint_reviews SET last_error='private http://source.invalid/key'");
  if (kind === "overflow") for (let i = 0; i < 91; i++) sqlite.prepare("INSERT INTO tenx_mint_review_reads(address,signature,slot,outcome,observed_at) VALUES(?,?,?,?,?)").run(address, signature(i + 1), i, "not_target_migration", at.toISOString());
  await expect(mintIntakeStatus(db, address, at)).rejects.toThrow();
});
it("checks runtime, browser origin and request identity before DB, and sanitizes source failures", async () => {
  const { db } = source(); vi.spyOn(db, "prepare").mockImplementation(() => { throw Error("private database details"); });
  const env = { TENX_DB: db, TENX_LOCAL_ONLY: "true" } as LocalEnv, target = `/api/10x/discovery/intake/solana/${address}`;
  const request = (path = target, headers = {}) => new Request("http://127.0.0.1:8794" + path, { headers });
  expect((await worker.fetch(request(), { ...env, TENX_LOCAL_ONLY: "false" })).status).toBe(503);
  expect((await worker.fetch(request(target, { origin: "https://evil.invalid", "sec-fetch-site": "cross-site" }), env)).status).toBe(403);
  for (const path of [target + "?cutoff=2026", target + "?a=1&a=2", "/api/10x/discovery/intake/solana/not-a-mint"]) expect((await worker.fetch(request(path), env)).status).toBe(400);
  expect(db.prepare).not.toHaveBeenCalled();
  const result = await worker.fetch(request(), env); expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "intake_status_unavailable" });
});
it("serves the exact bounded current status with no-store caching", async () => {
  const { sqlite, db } = source(); review(sqlite);
  const response = await worker.fetch(new Request(`http://127.0.0.1:8794/api/10x/discovery/intake/solana/${address}`), { TENX_DB: db, TENX_LOCAL_ONLY: "true" } as LocalEnv);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toMatchObject({ address, review: { state: "scanning" } });
});
