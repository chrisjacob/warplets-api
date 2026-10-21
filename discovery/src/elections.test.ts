import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { fixtureCandidates } from "./fixtures";
import { DEFAULT_POLICY, type Candidate } from "./model";
import { toBase58, hashJson } from "./solana";
import { createElection, dailyElection, electionRecord, electionSummaries, evaluateElection, freezeElection, replayElection } from "./elections";
import worker, { handle, type LocalEnv } from "./worker";
import sealedV1 from "../fixtures/election-v1.json";
import { ElectionRecordSchema } from "./election-model";

const opened: DatabaseSync[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
const at = new Date("2026-10-20T00:00:00Z"), key = (i: number) => toBase58(new Uint8Array(32).fill(i));
function database() {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const migration of readdirSync(new URL("../migrations/", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  const db = sqliteD1(sqlite);
  const env: LocalEnv = { TENX_DB: db, TENX_LOCAL_ONLY: "true", TENX_NODE_RELAY: "false", TENX_ADMIN_TOKEN: "a".repeat(64), TENX_RPC_URL: "https://api.mainnet-beta.solana.com", TENX_RPC_DAILY_LIMIT: "3000", TENX_MARKET_DAILY_LIMIT: "600", TENX_MARKET_PROVIDER: "geckoterminal", TENX_QUALITY_ENABLED: "true", TENX_QUALITY_RPC_DAILY_LIMIT: "1800", TENX_MARKET_ENABLED: "false", TENX_WALLET_ANALYSIS_ENABLED: "true", TENX_WALLET_RPC_DAILY_LIMIT: "800" };
  return { sqlite, db, env };
}
async function live(): Promise<Candidate> { return { ...(await fixtureCandidates(at))[0]!, mode: "live" }; }
async function put(db: D1Database, candidate: Candidate) { await db.prepare("INSERT OR REPLACE INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES(?1,?2,?3,?4,?5)").bind(candidate.mode, candidate.address, candidate.pool, JSON.stringify(candidate), candidate.checked_at).run(); }
const options = { id: "manual-00000000-0000-4000-8000-000000000001", kind: "manual" as const, reason: "Offline discovery rehearsal", now: at };
const req = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:8794/api/10x/${path}`, init);
const admin = (body: unknown) => ({ method: "POST", headers: { authorization: `Bearer ${"a".repeat(64)}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("immutable discovery election rehearsal", () => {
  it("replays the sealed synthetic v1 winner and all four decisions exactly", async () => {
    const record = ElectionRecordSchema.parse(sealedV1);
    expect(await replayElection(record)).toMatchObject({ status: "verified", provider_requests: 0 });
    expect(record.result_hash).toBe("80391bcd07d189af1c197e51b28a26d00841ea532e3845284246ee4cf8f07868");
    expect(record.result.counts).toEqual({ observed: 4, eligible: 1, provisional: 2, excluded: 1, shortlisted: 1 });
  });
  it("records no winner for missing holder/wallet evidence and excludes fixture data", async () => {
    const { db } = database(); await put(db, await live());
    for (const c of await fixtureCandidates(at)) await put(db, c);
    const record = await createElection(db, options);
    expect(record.result).toMatchObject({ outcome: "no_eligible_winner", winner_address: null, counts: { observed: 1, provisional: 1 }, voting_enabled: false, launch_enabled: false });
    expect(record.result.candidates[0]?.reasons).toContain("holder_concentration_unknown");
    expect(await replayElection(record)).toMatchObject({ status: "verified", provider_requests: 0 });
  });
  it("uses deterministic liquidity, creation, ASCII address ties and a capped shortlist", async () => {
    const c = await live(), candidates = [3, 1, 2].map(i => ({ ...c, address: key(i) }));
    const input = { ...freezeElection(candidates, at), policy: { ...DEFAULT_POLICY, require_holder_evidence: false, require_wallet_analysis: false, max_candidates: 2 } };
    const result = evaluateElection(input), asciiSorted = candidates.map(c => c.address).sort();
    expect(result.winner_address).toBe(asciiSorted[0]); expect(result.counts).toMatchObject({ eligible: 3, shortlisted: 2 });
    expect(result.candidates.filter(c => c.rank).map(c => c.rank)).toEqual([1, 2]);
    expect(evaluateElection({ ...input, candidates: [...candidates].reverse() })).toEqual(result);
    const richer = { ...candidates[0]!, market: { ...c.market!, liquidity_usd: 100000 } };
    expect(evaluateElection({ ...input, candidates: [richer, ...candidates.slice(1)] }).winner_address).toBe(richer.address);
    const older = { ...candidates[0]!, creation: { ...c.creation!, block_time: "2026-10-19T22:00:00.000Z" } };
    expect(evaluateElection({ ...input, candidates: [older, ...candidates.slice(1)] }).winner_address).toBe(older.address);
  });
  it("rechecks age and freshness at the frozen time without inventing cap from FDV", async () => {
    const c = await live(), input = { ...freezeElection([c], at), policy: { ...DEFAULT_POLICY, require_holder_evidence: false, require_wallet_analysis: false } };
    expect(evaluateElection(input).outcome).toBe("simulated_winner");
    expect(evaluateElection({ ...input, as_of: "2026-10-21T00:00:00.000Z" }).candidates[0]?.reasons).toEqual(expect.arrayContaining(["token_older_than_24h", "market_data_stale"]));
    expect(evaluateElection({ ...input, candidates: [{ ...c, market: { ...c.market!, market_cap_usd: null } }] }).winner_address).toBeNull();
  });
  it("rejects duplicate identities, fixture inputs and evidence later than the snapshot", async () => {
    const c = await live(), input = freezeElection([c], at);
    expect(() => evaluateElection({ ...input, candidates: [c, c] })).toThrow("election_duplicate_candidate");
    expect(() => evaluateElection({ ...input, candidates: [{ ...c, mode: "fixture" }] })).toThrow("election_fixture_input");
    expect(() => evaluateElection({ ...input, as_of: "2026-10-19T23:59:59.000Z" })).toThrow("election_evidence_from_future");
    expect(() => evaluateElection({ ...input, candidates: [{ ...c, creation: { ...c.creation!, fetched_at: "2026-10-20T00:00:01.000Z" } }] })).toThrow("election_evidence_from_future");
  });
  it("returns the original snapshot on retries after source rows disappear, with one audit", async () => {
    const { db } = database(); await put(db, await live());
    const first = await createElection(db, options);
    await db.prepare("DELETE FROM tenx_candidates").run();
    expect(await createElection(db, { ...options, now: new Date("2026-10-22T00:00:00Z") })).toEqual(first);
    expect((await db.prepare("SELECT count(*) AS n FROM tenx_audit WHERE action='election_snapshot'").first<{ n: number }>())?.n).toBe(1);
    expect(await electionSummaries(db)).toHaveLength(1);
  });
  it("rolls back the snapshot when audit persistence fails", async () => {
    const { db, sqlite } = database(); sqlite.exec("CREATE TRIGGER audit_fail BEFORE INSERT ON tenx_audit BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END");
    await expect(createElection(db, options)).rejects.toThrow("audit_unavailable");
    expect(await electionRecord(db, options.id)).toBeNull();
  });
  it("prevents overwrites/deletes and detects tampered inputs, result, metadata and recomputed hashes", async () => {
    const { db } = database(); const record = await createElection(db, options);
    await expect(db.prepare("UPDATE tenx_election_runs SET inputs='{}'").run()).rejects.toThrow("immutable_election");
    await expect(db.prepare("DELETE FROM tenx_election_runs").run()).rejects.toThrow("immutable_election");
    await expect(replayElection({ ...record, inputs: { ...record.inputs, policy: { ...record.inputs.policy, min_market_cap_usd: 1 } } })).rejects.toThrow("election_hash_mismatch");
    await expect(replayElection({ ...record, result: { ...record.result, gaps: [] } })).rejects.toThrow("election_hash_mismatch");
    await expect(replayElection({ ...record, day: "2026-10-19" })).rejects.toThrow("election_metadata_mismatch");
    const result = { ...record.result, gaps: [] }, result_hash = await hashJson(result);
    const metadata = { id: record.id, kind: record.kind, day: record.day, created_at: record.created_at, input_hash: record.input_hash, result_hash };
    await expect(replayElection({ ...record, result, result_hash, record_hash: await hashJson(metadata) })).rejects.toThrow("election_replay_mismatch");
  });
  it("records at most one daily actual-time snapshot, without backfilling sleeping days", async () => {
    const { db } = database(); const transport = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await dailyElection(db, at)).toMatchObject({ state: "recorded", id: "daily-2026-10-20" });
    expect(await dailyElection(db, new Date("2026-10-20T17:00:00Z"))).toMatchObject({ state: "already_recorded" });
    await dailyElection(db, new Date("2026-10-23T07:00:00Z"));
    const records = await electionSummaries(db); expect(records.map(r => r.day)).toEqual(["2026-10-23", "2026-10-20"]);
    expect(records[0]?.created_at).toBe("2026-10-23T07:00:00.000Z"); expect(transport).not.toHaveBeenCalled();
  });
  it("exposes cached public list/detail with verified replay, validates IDs and protects writes", async () => {
    const { env, db } = database(); await createElection(db, options);
    const transport = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const list = await (await handle(req("elections"), env)).json() as { data: { runs: unknown[] } }; expect(list.data.runs).toHaveLength(1);
    const detail = await (await handle(req(`elections/${options.id}`), env)).json() as { data: { replay: { status: string } } }; expect(detail.data.replay.status).toBe("verified");
    expect((await handle(req("elections/daily-2026-10-19"), env)).status).toBe(404);
    expect((await worker.fetch(req("elections/invalid"), env)).status).toBe(400);
    expect((await handle(req("admin/dry-run", { method: "POST" }), env)).status).toBe(401);
    expect((await handle(req("elections", admin({ reason: "attempted public write" })), env)).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
  });
  it("creates one snapshot/audit for a repeated operator request ID", async () => {
    const { env, db } = database(), body = { reason: "repeatable operator rehearsal", request_id: "00000000-0000-4000-8000-000000000002" };
    const first = await (await handle(req("admin/dry-run", admin(body)), env)).json();
    expect(await (await handle(req("admin/dry-run", admin(body)), env)).json()).toEqual(first);
    expect((await db.prepare("SELECT count(*) AS n FROM tenx_election_runs").first<{ n: number }>())?.n).toBe(1);
    expect((await db.prepare("SELECT count(*) AS n FROM tenx_audit").first<{ n: number }>())?.n).toBe(1);
  });
  it("runs daily rehearsal while source ingestion is paused or budgets are exhausted", async () => {
    const { env, db } = database(); await db.prepare("UPDATE tenx_control SET paused=1,reviewed_at=?1").bind(new Date().toISOString()).run();
    await db.prepare("INSERT INTO tenx_usage(provider,day,used) VALUES('rpc',?1,9999)").bind(new Date().toISOString().slice(0, 10)).run();
    const response = await (await handle(req("admin/maintenance", admin({ reason: "offline maintenance" })), env)).json();
    expect(response).toMatchObject({ local: true, election: { state: "recorded" } });
    expect((await db.prepare("SELECT used FROM tenx_usage").first<{ used: number }>())?.used).toBe(9999);
  });
  it("fails visibly rather than trimming an inventory above 500 candidates", async () => {
    const { db } = database(), c = await live();
    // This validates the collector bound before address/schema parsing.
    for (let i = 0; i < 501; i++) await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live',?1,?2,?3,?4)").bind(`row${i}`, c.pool, JSON.stringify(c), c.checked_at).run();
    await expect(createElection(db, options)).rejects.toThrow("election_candidate_limit");
    expect(await electionSummaries(db)).toEqual([]);
  });
  it("refuses oversized evidence before decoding and exposes a maintenance failure without losing the heartbeat", async () => {
    const { env, db } = database(); await db.prepare("INSERT INTO tenx_candidates(mode,address,pool,payload,checked_at) VALUES('live','oversized','pool',?1,?2)").bind("x".repeat(1_600_001), at.toISOString()).run();
    await expect(createElection(db, options)).rejects.toThrow("election_snapshot_size_limit");
    await db.prepare("UPDATE tenx_control SET reviewed_at=?1").bind(new Date().toISOString()).run();
    expect(await (await handle(req("admin/maintenance", admin({ reason: "bounded failure check" })), env)).json()).toMatchObject({ election: { state: "failed", error: "election_snapshot_size_limit" } });
    const status = await (await handle(req("system/status"), env)).json() as { data: { election_automation: { last_error: string }; automation: { heartbeat_at: string } } };
    expect(status.data.election_automation.last_error).toBe("election_snapshot_size_limit"); expect(status.data.automation.heartbeat_at).toBeTruthy();
    expect((status.data as {daily_limits?:{mint_intake?:number}}).daily_limits?.mint_intake).toBe(20);
    expect(await electionSummaries(db)).toEqual([]);
  });
});
