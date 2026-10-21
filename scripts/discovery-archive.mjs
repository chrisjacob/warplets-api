import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, constants, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const VERSION = "discovery-local-archive-v1";
const DATABASE = "discovery.sqlite";
const MANIFEST = "manifest.json";
const quote = value => `"${value.replaceAll('"', '""')}"`;
const digest = value => createHash("sha256").update(value).digest("hex");
const checksum = manifest => digest(JSON.stringify(manifest));

export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function regularFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw Error("Expected a regular file, not a link");
  return info;
}

// Resolve existing parents as well as lexical paths: a junction must not turn a
// scratch restore into a replacement/addition inside a live Wrangler store.
async function scratchDestination(file) {
  const lexical = path.resolve(file);
  const parent = await realpath(path.dirname(lexical));
  const resolved = path.join(parent, path.basename(lexical));
  if ([lexical, resolved].some(value => value.split(/[\\/]/).some(part => part.toLowerCase() === ".wrangler"))) {
    throw Error("Restore/export destinations must be outside .wrangler");
  }
  return resolved;
}

async function noJournal(file) {
  for (const suffix of ["-wal", "-journal"]) {
    try { await lstat(file + suffix); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw Error("Archive has a journal sidecar; a self-contained snapshot is required");
  }
}

function inspectDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=10000; PRAGMA query_only=ON; BEGIN");
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw Error("SQLite integrity check failed");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw Error("SQLite foreign key check failed");
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
    const names = schema.filter(row => row.type === "table").map(row => row.name);
    for (const required of ["d1_migrations", "tenx_candidates", "tenx_score_cohorts", "tenx_source_reservations"]) {
      if (!names.includes(required)) throw Error("Database is missing a Discovery archive marker table");
    }
    // dbstat reports allocated B-tree pages, including overflow pages. These are
    // physical bytes, not JSON payload sizes or a remote D1 billing estimate.
    const pages = db.prepare("SELECT name,sum(pgsize) AS bytes FROM dbstat GROUP BY name").all();
    const allocated = new Map(pages.map(row => [row.name, row.bytes]));
    const inventory = names.map(name => ({
      table: name,
      rows: db.prepare(`SELECT count(*) AS count FROM ${quote(name)}`).get().count,
      table_bytes: allocated.get(name) ?? 0,
      index_bytes: schema.filter(row => row.type === "index" && row.tbl_name === name)
        .reduce((total, row) => total + (allocated.get(row.name) ?? 0), 0),
    }));
    const pragma = name => Object.values(db.prepare(`PRAGMA ${name}`).get())[0];
    return {
      schema_sha256: digest(JSON.stringify(schema)),
      page_size: pragma("page_size"), page_count: pragma("page_count"), free_pages: pragma("freelist_count"),
      migrations: db.prepare("SELECT name FROM d1_migrations ORDER BY name").all().map(row => row.name),
      inventory,
    };
  } finally { db.close(); }
}

export async function exportArchive(source, directory) {
  await regularFile(source);
  const destination = await scratchDestination(directory);
  // No recursive mkdir or overwrite: an existing/partial archive is retained.
  await mkdir(destination, { mode: 0o700 });
  const started = new Date().toISOString();
  const file = path.join(destination, DATABASE);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=10000; PRAGMA query_only=ON; BEGIN");
    // Establish the read snapshot before copying, including committed WAL data.
    db.prepare("SELECT count(*) FROM sqlite_schema").get();
    const deadline = performance.now() + 120000;
    await backup(db, file, { rate: 256, progress() {
      if (performance.now() > deadline) throw Error("Backup exceeded two minutes; incomplete archive retained");
    } });
  } finally { db.close(); }
  const completed = new Date().toISOString();
  // Only the private copy is normalized. The live source is never checkpointed,
  // vacuumed, paused or written by this tool.
  const copy = new DatabaseSync(file);
  try { copy.exec("PRAGMA journal_mode=DELETE"); } finally { copy.close(); }
  await chmod(file, 0o600);
  await noJournal(file);
  const storage = inspectDatabase(file);
  const body = {
    version: VERSION,
    confidentiality: "private_full_store_including_identity_sessions_and_research",
    snapshot_started_at: started, snapshot_completed_at: completed,
    database: { file: DATABASE, bytes: (await stat(file)).size, sha256: await hashFile(file) },
    storage,
  };
  const manifest = { ...body, manifest_sha256: checksum(body) };
  await writeFile(path.join(destination, MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return manifest;
}

export async function verifyArchive(directory, expectedHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) throw Error("Provide the independently retained manifest SHA-256");
  const manifestFile = path.join(directory, MANIFEST);
  if ((await regularFile(manifestFile)).size > 1024 * 1024) throw Error("Archive manifest exceeds one MiB");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const { manifest_sha256, ...body } = manifest;
  if (manifest_sha256 !== expectedHash || checksum(body) !== expectedHash) throw Error("Archive manifest checksum mismatch");
  if (body.version !== VERSION || body.database?.file !== DATABASE) throw Error("Unsupported archive format");
  const started = Date.parse(body.snapshot_started_at), completed = Date.parse(body.snapshot_completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) throw Error("Invalid snapshot interval");
  const file = path.join(directory, DATABASE);
  await noJournal(file);
  if ((await regularFile(file)).size !== body.database.bytes || await hashFile(file) !== body.database.sha256) {
    throw Error("Archive database checksum/size mismatch");
  }
  if (!isDeepStrictEqual(inspectDatabase(file), body.storage)) throw Error("Archive inventory/schema mismatch");
  return manifest;
}

export async function restoreArchive(directory, expectedHash, target) {
  const manifest = await verifyArchive(directory, expectedHash);
  const destination = await scratchDestination(target);
  await noJournal(destination);
  // COPYFILE_EXCL refuses existing files and links; never opens a live store.
  await copyFile(path.join(directory, DATABASE), destination, constants.COPYFILE_EXCL);
  try {
    await chmod(destination, 0o600);
    if (await hashFile(destination) !== manifest.database.sha256 ||
        !isDeepStrictEqual(inspectDatabase(destination), manifest.storage)) throw Error("Restored database failed verification");
  } catch (error) {
    // This exact file was newly created above; never delete a directory/source.
    await unlink(destination);
    throw error;
  }
  return { restored: destination, database_sha256: manifest.database.sha256, tables: manifest.storage.inventory.length, runtime_activated: false };
}

export async function compareArchives(beforeDirectory, beforeHash, afterDirectory, afterHash) {
  const before = await verifyArchive(beforeDirectory, beforeHash);
  const after = await verifyArchive(afterDirectory, afterHash);
  const interval = Date.parse(after.snapshot_started_at) - Date.parse(before.snapshot_completed_at);
  if (interval <= 0) throw Error("Growth requires nonoverlapping snapshots in chronological order");
  const a = new Map(before.storage.inventory.map(row => [row.table, row]));
  const b = new Map(after.storage.inventory.map(row => [row.table, row]));
  return {
    before_manifest_sha256: beforeHash, after_manifest_sha256: afterHash,
    lineage: "operator_selected_same_store_not_independently_verified",
    minimum_elapsed_ms: interval,
    database_bytes_delta: after.database.bytes - before.database.bytes,
    schema_changed: before.storage.schema_sha256 !== after.storage.schema_sha256,
    tables: [...new Set([...a.keys(), ...b.keys()])].sort().map(table => ({
      table, state: !a.has(table) ? "added" : !b.has(table) ? "removed" : "retained",
      rows_delta: (b.get(table)?.rows ?? 0) - (a.get(table)?.rows ?? 0),
      allocated_bytes_delta: (b.get(table)?.table_bytes ?? 0) + (b.get(table)?.index_bytes ?? 0)
        - (a.get(table)?.table_bytes ?? 0) - (a.get(table)?.index_bytes ?? 0),
    })),
    forecast: "not_established_by_two_snapshots",
  };
}

function summary(manifest) {
  return {
    manifest_sha256: manifest.manifest_sha256, database_sha256: manifest.database.sha256,
    database_bytes: manifest.database.bytes, snapshot_started_at: manifest.snapshot_started_at,
    snapshot_completed_at: manifest.snapshot_completed_at, tables: manifest.storage.inventory.length,
    rows: manifest.storage.inventory.reduce((sum, row) => sum + row.rows, 0),
    largest_tables: [...manifest.storage.inventory].sort((a, b) => b.table_bytes + b.index_bytes - a.table_bytes - a.index_bytes).slice(0, 5),
  };
}

async function main(args) {
  const [action, ...values] = args;
  if (action === "export" && values.length === 2) return summary(await exportArchive(...values));
  if (action === "verify" && values.length === 2) return summary(await verifyArchive(...values));
  if (action === "restore" && values.length === 3) return restoreArchive(...values);
  if (action === "growth" && values.length === 4) return compareArchives(...values);
  throw Error("Usage: node scripts/discovery-archive.mjs export SOURCE.sqlite NEW_DIRECTORY | verify DIRECTORY MANIFEST_SHA256 | restore DIRECTORY MANIFEST_SHA256 NEW_SCRATCH.sqlite | growth BEFORE_DIRECTORY BEFORE_SHA256 AFTER_DIRECTORY AFTER_SHA256");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
