import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../../app/functions/_lib/sqliteTestDb";
import { control } from "./store";
import { key, signature } from "./wallet-fixtures.test-helper";
import { MAINNET_GENESIS, type SignatureRow } from "./rpc";
import { runCycle } from "./ingest";
import schema from "../protocol/pump-schema.json";
import { PUMP } from "./pump";
import { commitMigrationHarvest as commitHarvest, harvestCheckpointReady, migrationHarvestRequest, migrationHarvestTransition, readHarvestCheckpoint, type HarvestCheckpoint } from "./migration-harvest";
const commitMigrationHarvest = (db: D1Database, owner: string, checkpoint: HarvestCheckpoint, rows: SignatureRow[], at: Date) => commitHarvest(db, owner, checkpoint, rows, at, key(7));

const opened: DatabaseSync[] = [], at = new Date("2026-10-22T10:00:00.000Z");
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function setup(migrated = true) {
  const sqlite = new DatabaseSync(":memory:"); opened.push(sqlite);
  for (const file of readdirSync(new URL("../migrations/", import.meta.url)).filter(file => file.endsWith(".sql") && (migrated || !file.startsWith("0047_"))).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  sqlite.prepare("UPDATE tenx_control SET lease_owner='owner',lease_until=?1,migration_cursor=?2 WHERE id=1").run(new Date(at.getTime() + 600000).toISOString(), signature(250));
  const db = sqliteD1(sqlite);
  return { sqlite, db, checkpoint: async () => readHarvestCheckpoint(await control(db))! };
}
const row = (n: number, slot = 10000 - n): SignatureRow => ({ signature: signature(n), slot, err: null,
  confirmationStatus: "finalized", blockTime: Math.floor(at.getTime() / 1000) - n });
const page = () => Array.from({ length: 30 }, (_, n) => row(n + 1));

describe("durable bounded migration authority harvest", () => {
  it("holds a page with an omitted RPC error field instead of treating it as a failed signature and advancing", async () => {
    const f=setup(),checkpoint=await f.checkpoint(),{err,...incomplete}=row(1);
    expect(()=>migrationHarvestTransition(checkpoint,[incomplete],at)).toThrow('migration_harvest_page_invalid');
    expect(await f.checkpoint()).toEqual(checkpoint);expect(f.sqlite.prepare('SELECT count(*) n FROM tenx_pending_signatures').get()).toEqual({n:0});
  });
  it("retains a frozen newest head and reads past the first thirty without advancing the completed cursor", async () => {
    const f = setup(), first = await f.checkpoint();
    expect(migrationHarvestRequest(first)).toEqual({ limit: 30, before: undefined, until: signature(250) });
    expect(await commitMigrationHarvest(f.db, "owner", first, page(), at)).toMatchObject({ state: "continuing", observed: 30, queued: 30, exhaustive: false });
    const second = await f.checkpoint();
    expect(second).toMatchObject({ migration_cursor: signature(250), harvest_head: signature(1), harvest_before: signature(30), harvest_before_slot: 9970 });
    expect(migrationHarvestRequest(second)).toEqual({ limit: 30, before: signature(30), until: signature(250) });
    expect(await commitMigrationHarvest(f.db, "owner", second, [row(31), row(32)], new Date(at.getTime() + 300000))).toMatchObject({ state: "boundary_observed", queued: 2 });
    expect(await f.checkpoint()).toMatchObject({ migration_cursor: signature(1), harvest_head: null, harvest_before: null, harvest_before_slot: null, harvest_revision: 2 });
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 32 });
    // New arrivals above the frozen head are requested in the next scan.
    expect(migrationHarvestRequest(await f.checkpoint()).until).toBe(signature(1));
  });
  it("resumes continuation after rereading only durable state and preserves original inbox history", async () => {
    const f = setup();
    await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), page(), at);
    f.sqlite.prepare("UPDATE tenx_pending_signatures SET processed_at=?1,result='migration_verified' WHERE signature=?2").run(at.toISOString(), signature(1));
    const restored = readHarvestCheckpoint(JSON.parse(JSON.stringify(await control(f.db))))!;
    await commitMigrationHarvest(f.db, "owner", restored, [row(31)], new Date(at.getTime() + 1000));
    expect(f.sqlite.prepare("SELECT queued_at,processed_at,result FROM tenx_pending_signatures WHERE signature=?1").get(signature(1)))
      .toEqual({ queued_at: at.toISOString(), processed_at: at.toISOString(), result: "migration_verified" });
  });
  it("allows nonlexical same-slot transaction order across page boundaries", async () => {
    const f = setup(), first = page().map(item => ({ ...item, slot: 10000 }));
    // Reversing the signatures within a slot must not introduce a made-up order.
    first.reverse();
    await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), first, at);
    expect(migrationHarvestRequest(await f.checkpoint()).before).toBe(signature(1));
    await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), [row(31, 10000), row(32, 9999)], new Date(at.getTime() + 1000));
    expect((await f.checkpoint()).migration_cursor).toBe(signature(30));
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 32 });
  });
  it("closes an exact full page only after a subsequent empty response", async () => {
    const f = setup(); await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), page(), at);
    await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), [], new Date(at.getTime() + 1000));
    expect(await f.checkpoint()).toMatchObject({ migration_cursor: signature(1), harvest_head: null, harvest_before: null });
  });
  it("keeps an empty first scan at its existing boundary and handles an empty bootstrap", async () => {
    const f = setup(); await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), [], at);
    expect((await f.checkpoint()).migration_cursor).toBe(signature(250));
    f.sqlite.prepare("UPDATE tenx_control SET migration_cursor=NULL").run();
    await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), [], new Date(at.getTime() + 1000));
    expect((await f.checkpoint()).migration_cursor).toBeNull();
  });
  it("counts finalized failed signatures for pagination without queueing transaction reads", async () => {
    const f = setup(), rows = page().map(item => ({ ...item, err: { InstructionError: [0, "failed"] } }));
    expect(await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), rows, at)).toMatchObject({ state: "continuing", observed: 30, queued: 0 });
    expect((await f.checkpoint()).harvest_before).toBe(signature(30));
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 0 });
  });
  it.each(["duplicate", "oversized", "future", "unfinalized", "ascending", "until", "before", "newer_slot"])("holds an invalid %s page without any mutation", async kind => {
    const f = setup(); await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), page(), at);
    const checkpoint = await f.checkpoint(), before = f.sqlite.prepare("SELECT * FROM tenx_control").get();
    const rows = kind === "duplicate" ? [row(31), row(31)] : kind === "oversized" ? Array.from({ length: 31 }, (_, n) => row(n + 31))
      : kind === "future" ? [{ ...row(31), blockTime: Math.floor(at.getTime() / 1000) + 1 }]
      : kind === "unfinalized" ? [{ ...row(31), confirmationStatus: "confirmed" }]
      : kind === "ascending" ? [row(32), row(31)] : kind === "until" ? [row(250)] : kind === "before" ? [row(30)] : [row(31, 9971)];
    expect(() => migrationHarvestTransition(checkpoint, rows, at)).toThrow("migration_harvest_page_invalid");
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, rows, at)).rejects.toThrow("migration_harvest_page_invalid");
    expect(f.sqlite.prepare("SELECT * FROM tenx_control").get()).toEqual(before);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 30 });
  });
  it.each(["owner", "expired", "paused", "checkpoint"])("fences a changed %s before committing either inbox or cursor", async kind => {
    const f = setup(), checkpoint = await f.checkpoint();
    if (kind === "owner") f.sqlite.exec("UPDATE tenx_control SET lease_owner='replacement'");
    if (kind === "expired") f.sqlite.prepare("UPDATE tenx_control SET lease_until=?1").run(at.toISOString());
    if (kind === "paused") f.sqlite.exec("UPDATE tenx_control SET paused=1");
    if (kind === "checkpoint") f.sqlite.exec("UPDATE tenx_control SET harvest_revision=harvest_revision+1");
    const before = f.sqlite.prepare("SELECT * FROM tenx_control").get();
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, page(), at)).rejects.toThrow("migration_harvest_lease_or_checkpoint_changed");
    expect(f.sqlite.prepare("SELECT * FROM tenx_control").get()).toEqual(before);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 0 });
  });
  it("does not let a stale same-owner publication append different rows through another commit's revision", async () => {
    const f = setup(), checkpoint = await f.checkpoint();
    await commitMigrationHarvest(f.db, "owner", checkpoint, [row(1)], at);
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, [row(2)], at)).rejects.toThrow("migration_harvest_lease_or_checkpoint_changed");
    expect(f.sqlite.prepare("SELECT signature FROM tenx_pending_signatures").all()).toEqual([{ signature: signature(1) }]);
  });
  it("rolls back its checkpoint and all inserts on a conflicting retained signature identity", async () => {
    const f = setup(), checkpoint = await f.checkpoint();
    f.sqlite.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at) VALUES(?1,?2,?3)").run(signature(2), 9000, at.toISOString());
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, [row(1), row(2)], at)).rejects.toThrow();
    expect(await f.checkpoint()).toEqual(checkpoint);
    expect(f.sqlite.prepare("SELECT signature,slot FROM tenx_pending_signatures").all()).toEqual([{ signature: signature(2), slot: 9000 }]);
  });
  it("holds a conflicting failed-row slot before filtering failed transactions from the inbox", async () => {
    const f = setup(), checkpoint = await f.checkpoint();
    f.sqlite.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at,processed_at,result) VALUES(?1,?2,?3,?3,'migration_verified')").run(signature(2), 9000, at.toISOString());
    const before = f.sqlite.prepare("SELECT * FROM tenx_pending_signatures ORDER BY signature").all();
    const failed = { ...row(2), err: { InstructionError: [0, "failed"] } };
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, [row(1), failed], at)).rejects.toThrow("migration_harvest_lease_or_checkpoint_changed");
    expect(await f.checkpoint()).toEqual(checkpoint);
    expect(f.sqlite.prepare("SELECT * FROM tenx_pending_signatures ORDER BY signature").all()).toEqual(before);
  });
  it("rolls back the checkpoint if an inbox insertion fails", async () => {
    const f = setup(), checkpoint = await f.checkpoint();
    f.sqlite.exec("CREATE TRIGGER refuse_harvest BEFORE INSERT ON tenx_pending_signatures BEGIN SELECT RAISE(ABORT,'test_inbox_failure'); END");
    await expect(commitMigrationHarvest(f.db, "owner", checkpoint, page(), at)).rejects.toThrow("test_inbox_failure");
    expect(await f.checkpoint()).toEqual(checkpoint);
    expect(f.sqlite.prepare("SELECT count(*) AS n FROM tenx_pending_signatures").get()).toEqual({ n: 0 });
  });
  it("holds a present but incomplete checkpoint instead of inventing a new boundary", async () => {
    const f = setup(); f.sqlite.prepare("UPDATE tenx_control SET harvest_head=?1").run(signature(1));
    expect(harvestCheckpointReady(await control(f.db))).toBe(true);
    expect(() => readHarvestCheckpoint(f.sqlite.prepare("SELECT * FROM tenx_control").get() as unknown as Awaited<ReturnType<typeof control>>)).toThrow("migration_harvest_checkpoint_invalid");
  });
  it("holds a changed authority during continuation and after observing its completed boundary", async () => {
    const f = setup(); await commitMigrationHarvest(f.db, "owner", await f.checkpoint(), page(), at);
    const checkpoint = await f.checkpoint();
    await expect(commitHarvest(f.db, "owner", checkpoint, [row(31)], at, key(8))).rejects.toThrow("migration_harvest_authority_changed");
    expect(await f.checkpoint()).toEqual(checkpoint);
    await commitMigrationHarvest(f.db, "owner", checkpoint, [], new Date(at.getTime() + 1000));
    const completed = await f.checkpoint();
    await expect(commitHarvest(f.db, "owner", completed, [row(32)], at, key(8))).rejects.toThrow("migration_harvest_authority_changed");
    expect(await f.checkpoint()).toEqual(completed);
  });
  it("leaves pre-migration harvesting held while processing retained work with no authority/signature reads", async () => {
    const f = setup(false); f.sqlite.exec("UPDATE tenx_control SET lease_owner=NULL,lease_until=NULL");
    f.sqlite.prepare("INSERT INTO tenx_pending_signatures(signature,slot,queued_at) VALUES(?1,?2,?3)").run(signature(1), 9999, at.toISOString());
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)); expect(["getGenesisHash", "getTransaction"]).toContain(request.method);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: request.method === "getGenesisHash" ? MAINNET_GENESIS : { version: 2 } });
    });
    expect(harvestCheckpointReady(await control(f.db))).toBe(false);
    const result = await runCycle({ db: f.db, rpcUrl: "https://rpc.invalid", rpcDailyLimit: 100,
      marketDailyLimit: 100, marketEnabled: false, transport }, at);
    expect(result).toMatchObject({ state: "succeeded", processed: 0, rpc_calls: 2, harvest: { state: "migration_required", exhaustive: false } });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(f.sqlite.prepare("SELECT result FROM tenx_pending_signatures WHERE signature=?1").get(signature(1))).toEqual({ result: "unsupported_transaction_version" });
    expect(await control(f.db)).toMatchObject({ last_harvest: null, migration_cursor: signature(250) });
  });
  it("uses exactly one thirty-signature authority request per ordinary harvest across two integrated cycles", async () => {
    const f = setup(); f.sqlite.exec("UPDATE tenx_control SET lease_owner=NULL,lease_until=NULL");
    const global = new Uint8Array(145); global.set(schema.global_discriminator); global.fill(7, 113);
    const account = { owner: PUMP, executable: false, data: [btoa(String.fromCharCode(...global)), "base64"] };
    const requests: Record<string, unknown>[] = [];
    const transport = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)); let result: unknown;
      if (request.method === "getGenesisHash") result = MAINNET_GENESIS;
      else if (request.method === "getMultipleAccounts") result = { context: { slot: 11000 }, value: [account] };
      else {
        expect(request.method).toBe("getSignaturesForAddress"); requests.push(request.params[1]);
        result = (requests.length === 1 ? page() : [row(31), row(32)]).map(item => ({ ...item, err: { InstructionError: [0, "failed"] } }));
      }
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    });
    const settings = { db: f.db, rpcUrl: "https://rpc.invalid", rpcDailyLimit: 100, marketDailyLimit: 100, marketEnabled: false, transport };
    expect(await runCycle(settings, at)).toMatchObject({ state: "succeeded", rpc_calls: 3, harvest: { state: "continuing", observed: 30, queued: 0 } });
    expect(await runCycle(settings, new Date(at.getTime() + 301000))).toMatchObject({ state: "succeeded", rpc_calls: 3, harvest: { state: "boundary_observed", observed: 2, queued: 0 } });
    expect(requests).toEqual([
      { commitment: "finalized", limit: 30, until: signature(250) },
      { commitment: "finalized", limit: 30, before: signature(30), until: signature(250) },
    ]);
    expect(transport).toHaveBeenCalledTimes(6);
  });
});
