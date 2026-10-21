import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { createHash } from "node:crypto";
import { exportArchive, verifyArchive, restoreArchive, compareArchives, hashFile } from "./discovery-archive.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tenx-archive-"));
  const source = path.join(root, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);
    INSERT INTO d1_migrations VALUES('0043_fixture.sql');
    CREATE TABLE tenx_candidates(address TEXT PRIMARY KEY);
    INSERT INTO tenx_candidates VALUES('original-mint');
    CREATE TABLE tenx_score_cohorts(id TEXT PRIMARY KEY, address TEXT REFERENCES tenx_candidates(address), payload BLOB);
    INSERT INTO tenx_score_cohorts VALUES('frozen-v4','original-mint',x'00ff01');
    CREATE TABLE tenx_source_reservations(id TEXT PRIMARY KEY, state TEXT);
    INSERT INTO tenx_source_reservations VALUES('attempt','failed');
    CREATE INDEX reservation_state ON tenx_source_reservations(state);
    CREATE TABLE "odd""; DROP TABLE tenx_candidates; --"(data TEXT);
  `);
  try { await run({ root, source, db, archive: path.join(root, "archive") }); }
  finally {
    db.close();
    const absolute = path.resolve(root);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(absolute).startsWith("tenx-archive-"));
    await rm(absolute, { recursive: true, force: true });
  }
}

test("complete WAL snapshot restores exact frozen blobs, failures, schema and index inventory without changing source", () => fixture(async ({ root, source, db, archive }) => {
  const before = db.prepare("SELECT total_changes() count").get().count;
  assert.ok((await stat(source + "-wal")).size > 0);
  const manifest = await exportArchive(source, archive);
  assert.equal(db.prepare("SELECT total_changes() count").get().count, before);
  assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  assert.equal(manifest.storage.inventory.find(row => row.table === "tenx_score_cohorts").rows, 1);
  assert.ok(manifest.storage.inventory.find(row => row.table === "tenx_source_reservations").index_bytes > 0);
  assert.deepEqual(await verifyArchive(archive, manifest.manifest_sha256), manifest);
  const destination = path.join(root, "restored.sqlite");
  const result = await restoreArchive(archive, manifest.manifest_sha256, destination);
  assert.equal(result.runtime_activated, false);
  assert.equal(await hashFile(destination), manifest.database.sha256);
  const restored = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.deepEqual([...restored.prepare("SELECT payload FROM tenx_score_cohorts").get().payload], [0, 255, 1]);
    assert.equal(restored.prepare("SELECT state FROM tenx_source_reservations").get().state, "failed");
    assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { restored.close(); }
  // Subsequent source evidence is neither backfilled into the frozen copy nor lost.
  db.exec("INSERT INTO tenx_candidates VALUES('later-mint')");
  assert.equal((await verifyArchive(archive, manifest.manifest_sha256)).storage.inventory.find(row => row.table === "tenx_candidates").rows, 1);
}));

test("existing archive and restore targets are never overwritten", () => fixture(async ({ root, source, archive }) => {
  const manifest = await exportArchive(source, archive);
  await assert.rejects(exportArchive(source, archive), /EEXIST/);
  const before = await readFile(source);
  await assert.rejects(restoreArchive(archive, manifest.manifest_sha256, source), /EEXIST|journal sidecar/);
  assert.deepEqual(await readFile(source), before);
  const target = path.join(root, "existing.sqlite");
  await writeFile(target, "preserve");
  await assert.rejects(restoreArchive(archive, manifest.manifest_sha256, target), /EEXIST/);
  assert.equal(await readFile(target, "utf8"), "preserve");
}));

test("a concurrent WAL writer can continue while the complete snapshot remains internally consistent", () => fixture(async ({ source, db, archive }) => {
  db.exec("CREATE TABLE large_payload(data BLOB); INSERT INTO large_payload VALUES(zeroblob(16777216)); CREATE TABLE concurrent_pairs(id INTEGER PRIMARY KEY, value INTEGER CHECK(value=id));");
  const writer = new DatabaseSync(source);
  let writes = 0;
  const timer = setInterval(() => {
    writer.prepare("INSERT INTO concurrent_pairs VALUES(?,?)").run(++writes, writes);
  }, 1);
  try {
    const manifest = await exportArchive(source, archive);
    assert.ok(writes > 0, "writer must run during asynchronous backup");
    const saved = new DatabaseSync(path.join(archive, "discovery.sqlite"), { readOnly: true });
    try {
      const sample = saved.prepare("SELECT count(*) AS count,max(id) AS last FROM concurrent_pairs").get();
      assert.ok(sample.count <= writes);
      assert.equal(sample.count, sample.last ?? 0);
    } finally { saved.close(); }
    assert.equal((await verifyArchive(archive, manifest.manifest_sha256)).database.sha256, manifest.database.sha256);
  } finally { clearInterval(timer); writer.close(); }
}));

test("checksums reject missing/wrong trust anchors, modified manifest and modified database", () => fixture(async ({ source, archive }) => {
  const manifest = await exportArchive(source, archive);
  await assert.rejects(verifyArchive(archive), /independently retained/);
  await assert.rejects(verifyArchive(archive, "a".repeat(64)), /manifest checksum/);
  const file = path.join(archive, "manifest.json");
  const original = await readFile(file);
  await writeFile(file, original.toString().replace('"rows": 1', '"rows": 2'));
  await assert.rejects(verifyArchive(archive, manifest.manifest_sha256), /manifest checksum/);
  await writeFile(file, original);
  await appendFile(path.join(archive, "discovery.sqlite"), "corrupt");
  await assert.rejects(verifyArchive(archive, manifest.manifest_sha256), /database checksum/);
}));

test("archives with extra journal data or a linked database are rejected", () => fixture(async ({ root, source, archive }) => {
  const manifest = await exportArchive(source, archive);
  const journal = path.join(archive, "discovery.sqlite-wal");
  await writeFile(journal, "unaccounted");
  await assert.rejects(verifyArchive(archive, manifest.manifest_sha256), /journal sidecar/);
  await rm(journal);
  const alternate = path.join(root, "alternate");
  await mkdir(alternate);
  await writeFile(path.join(alternate, "manifest.json"), await readFile(path.join(archive, "manifest.json")));
  // Directory junctions work without Windows symlink privileges. The restore
  // test below covers junction resolution; regular-file links are checked here
  // on platforms which permit their creation.
  if (process.platform !== "win32") {
    await symlink(path.join(archive, "discovery.sqlite"), path.join(alternate, "discovery.sqlite"));
    await assert.rejects(verifyArchive(alternate, manifest.manifest_sha256), /regular file/);
  }
}));

test("a checksummed manifest cannot substitute incorrect row/schema measurements", () => fixture(async ({ source, archive }) => {
  const manifest = await exportArchive(source, archive);
  const { manifest_sha256, ...body } = manifest;
  body.storage.inventory[0].rows += 1;
  const changed = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  await writeFile(path.join(archive, "manifest.json"), JSON.stringify({ ...body, manifest_sha256: changed }));
  await assert.rejects(verifyArchive(archive, changed), /inventory\/schema mismatch/);
}));

test("Wrangler destinations and junction aliases cannot receive a restore/export", () => fixture(async ({ root, source, archive }) => {
  const manifest = await exportArchive(source, archive);
  const runtime = path.join(root, ".wrangler");
  await mkdir(runtime);
  await assert.rejects(restoreArchive(archive, manifest.manifest_sha256, path.join(runtime, "new.sqlite")), /outside .wrangler/);
  await assert.rejects(exportArchive(source, path.join(runtime, "archive")), /outside .wrangler/);
  const alias = path.join(root, "runtime-alias");
  await symlink(runtime, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(restoreArchive(archive, manifest.manifest_sha256, path.join(alias, "new.sqlite")), /outside .wrangler/);
  await assert.rejects(exportArchive(source, path.join(alias, "archive")), /outside .wrangler/);
}));

test("bad foreign keys fail the export without a usable manifest", () => fixture(async ({ source, db, archive }) => {
  db.exec("PRAGMA foreign_keys=OFF; INSERT INTO tenx_score_cohorts VALUES('invalid','missing',x'00')");
  await assert.rejects(exportArchive(source, archive), /foreign key/);
  await assert.rejects(stat(path.join(archive, "manifest.json")), /ENOENT/);
}));

test("non-Discovery stores fail closed and retain partial copies", () => fixture(async ({ root }) => {
  const source = path.join(root, "other.sqlite");
  const db = new DatabaseSync(source); db.exec("CREATE TABLE unrelated(id TEXT)"); db.close();
  const archive = path.join(root, "other-archive");
  await assert.rejects(exportArchive(source, archive), /Discovery archive marker/);
  assert.ok((await stat(path.join(archive, "discovery.sqlite"))).size > 0);
  await assert.rejects(stat(path.join(archive, "manifest.json")), /ENOENT/);
}));

test("growth measures chronological verified snapshots, retains added/removed tables and refuses reversed/same snapshots", () => fixture(async ({ root, source, db, archive }) => {
  const before = await exportArchive(source, archive);
  await setTimeout(5);
  db.exec("INSERT INTO tenx_candidates VALUES('second'); CREATE TABLE added(id TEXT); DROP TABLE \"odd\"\"; DROP TABLE tenx_candidates; --\"");
  const afterDirectory = path.join(root, "after");
  const after = await exportArchive(source, afterDirectory);
  const result = await compareArchives(archive, before.manifest_sha256, afterDirectory, after.manifest_sha256);
  assert.equal(result.tables.find(row => row.table === "tenx_candidates").rows_delta, 1);
  assert.equal(result.tables.find(row => row.table === "added").state, "added");
  assert.equal(result.tables.find(row => row.table.startsWith("odd")).state, "removed");
  assert.equal(result.schema_changed, true);
  assert.equal(result.forecast, "not_established_by_two_snapshots");
  await assert.rejects(compareArchives(afterDirectory, after.manifest_sha256, archive, before.manifest_sha256), /chronological/);
  await assert.rejects(compareArchives(archive, before.manifest_sha256, archive, before.manifest_sha256), /chronological/);
}));
