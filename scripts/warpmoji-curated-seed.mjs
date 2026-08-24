import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(import.meta.dirname, "..");
const APP_DIR = join(ROOT, "app");
const WRANGLER = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const DEFAULT_JSON = join(ROOT, "seeds", "warpmoji", "curated-seed.v1.json");
const SEED_SCHEMA_VERSION = 1;

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  pnpm warpmoji:export-curated [-- --output <json-path>]
  pnpm warpmoji:import-curated -- --target local|preview|production [--input <json-path>] [--dry-run] [--confirm-production IMPORT_WARPMOJI_CURATED_SEED]`);
  process.exit(message ? 1 : 0);
}

function parseArgs(values) {
  const [command = "", ...rest] = values;
  const options = { command, input: DEFAULT_JSON, output: DEFAULT_JSON, target: "", dryRun: false, confirmation: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--input") options.input = resolve(ROOT, rest[++index] ?? "");
    else if (arg === "--output") options.output = resolve(ROOT, rest[++index] ?? "");
    else if (arg === "--target") options.target = rest[++index] ?? "";
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--confirm-production") options.confirmation = rest[++index] ?? "";
    else if (arg === "--help" || arg === "-h") usage();
    else usage(`Unknown argument: ${arg}`);
  }
  return options;
}

function runWrangler(args) {
  if (!existsSync(WRANGLER)) throw new Error("Wrangler is not installed. Run pnpm install first.");
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: APP_DIR,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    // Workerd can abort during local D1 startup on Windows when Wrangler's stdin
    // is replaced with Node's default anonymous pipe.
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `Wrangler exited with ${result.status}`);
  }
  return result.stdout;
}

function localDatabasePath() {
  const override = process.env.WARPMOJI_LOCAL_DB_PATH?.trim();
  if (override) {
    const path = resolve(ROOT, override);
    if (!existsSync(path)) throw new Error(`WARPMOJI_LOCAL_DB_PATH does not exist: ${path}`);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'warpmoji_emoji_groups'").get()) {
        throw new Error(`WARPMOJI_LOCAL_DB_PATH is not an initialized Warpmoji database: ${path}`);
      }
    } finally {
      db.close();
    }
    return path;
  }
  const directory = join(APP_DIR, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
  if (!existsSync(directory)) throw new Error("Local D1 state was not found. Start warplet-local or apply the local migrations first.");
  const matches = [];
  for (const name of readdirSync(directory).filter((value) => value.endsWith(".sqlite") && value !== "metadata.sqlite")) {
    const path = join(directory, name);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'warpmoji_emoji_groups'").get();
      if (row) matches.push(path);
    } finally {
      db.close();
    }
  }
  if (matches.length !== 1) throw new Error(`Expected exactly one initialized local Warpmoji D1 database; found ${matches.length}.`);
  return matches[0];
}

function localQueryBatches(statements) {
  const db = new DatabaseSync(localDatabasePath(), { readOnly: true });
  try {
    return statements.map((statement) => db.prepare(statement).all());
  } finally {
    db.close();
  }
}

function queryBatches(target, statements) {
  if (target === "local") return localQueryBatches(statements);
  const locationArgs = target === "local"
    ? ["--local"]
    : target === "preview"
      ? ["--remote", "--env", "preview"]
      : ["--remote"];
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "warpmoji-query-"));
  const queryPath = join(temporaryDirectory, "query.sql");
  try {
    writeFileSync(queryPath, `${statements.join(";\n")};\n`, "utf8");
    const output = runWrangler(["d1", "execute", "WARPLETS", ...locationArgs, "--json", "--file", queryPath]);
    const batches = JSON.parse(output);
    if (!Array.isArray(batches) || batches.some((batch) => batch?.success !== true)) throw new Error(`${target} D1 query failed.`);
    return batches.map((batch) => Array.isArray(batch.results) ? batch.results : []);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function query(target, sql) {
  return queryBatches(target, [sql])[0] ?? [];
}

function stablePayload(payload) {
  return {
    seedSchemaVersion: payload.seedSchemaVersion,
    unicodeVersion: payload.unicodeVersion,
    scoringVersions: payload.scoringVersions,
    curationUpdatedAt: payload.curationUpdatedAt,
    reviewedGroups: payload.reviewedGroups,
    approvedMatches: payload.approvedMatches,
    rejectedMatches: payload.rejectedMatches,
  };
}

function checksum(payload) {
  return createHash("sha256").update(JSON.stringify(stablePayload(payload))).digest("hex");
}

function sqlValue(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Seed contains a non-finite number.");
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function validateSeed(raw) {
  if (!raw || typeof raw !== "object" || raw.seedSchemaVersion !== SEED_SCHEMA_VERSION) throw new Error("Unsupported Warpmoji curated seed schema.");
  if (!Array.isArray(raw.reviewedGroups) || !Array.isArray(raw.approvedMatches) || !Array.isArray(raw.rejectedMatches)) throw new Error("Warpmoji curated seed arrays are missing.");
  if (!Array.isArray(raw.scoringVersions) || typeof raw.unicodeVersion !== "string" || !/^[a-f0-9]{64}$/.test(raw.checksum ?? "")) throw new Error("Warpmoji curated seed metadata is invalid.");
  const actualChecksum = checksum(raw);
  if (actualChecksum !== raw.checksum) throw new Error(`Warpmoji curated seed checksum mismatch. Expected ${raw.checksum}; calculated ${actualChecksum}.`);
  const groupKeys = new Set();
  for (const group of raw.reviewedGroups) {
    if (typeof group?.emoji !== "string" || !group.emoji || typeof group.reviewedAt !== "string") throw new Error("Invalid reviewed group in Warpmoji seed.");
    if (groupKeys.has(group.emoji)) throw new Error(`Duplicate reviewed group: ${group.emoji}`);
    groupKeys.add(group.emoji);
  }
  const decisionKeys = new Set();
  for (const [kind, matches] of [["approved", raw.approvedMatches], ["rejected", raw.rejectedMatches]]) {
    for (const match of matches) {
      if (typeof match?.emoji !== "string" || !match.emoji || !Number.isInteger(match.tokenId) || match.tokenId < 1 || match.tokenId > 10000) throw new Error(`Invalid ${kind} match in Warpmoji seed.`);
      const key = `${match.emoji}\u0000${match.tokenId}`;
      if (decisionKeys.has(key)) throw new Error(`Conflicting or duplicate Warpmoji decision: ${match.emoji} / ${match.tokenId}`);
      decisionKeys.add(key);
    }
  }
  return raw;
}

function seedSql(seed) {
  const lines = [
    "-- GENERATED FILE. Source of truth: curated-seed.v1.json",
    `-- SHA-256: ${seed.checksum}`,
    "-- This replaces Warpmoji curation state; it does not replace the generated Unicode/candidate catalog.",
    "PRAGMA foreign_keys = ON;",
    "UPDATE warpmoji_candidates SET status = 'suggested', reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP;",
    "UPDATE warpmoji_emoji_groups SET reviewed_at = NULL, reviewed_by_fid = NULL, approved_count = 0, updated_at = CURRENT_TIMESTAMP;",
    "DELETE FROM warpmoji_rejections;",
  ];
  for (const match of seed.approvedMatches) {
    lines.push(`UPDATE warpmoji_candidates SET status = 'approved', assignment = ${sqlValue(match.assignment)}, reviewed_at = ${sqlValue(match.reviewedAt)}, reviewed_by_fid = ${sqlValue(match.reviewedByFid)}, updated_at = ${sqlValue(match.updatedAt)} WHERE canonical_emoji = ${sqlValue(match.emoji)} AND token_id = ${match.tokenId};`);
  }
  for (const match of seed.rejectedMatches) {
    lines.push(`UPDATE warpmoji_candidates SET status = 'rejected', reviewed_at = ${sqlValue(match.rejectedAt)}, reviewed_by_fid = ${sqlValue(match.rejectedByFid)}, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ${sqlValue(match.emoji)} AND token_id = ${match.tokenId};`);
    lines.push(`INSERT INTO warpmoji_rejections (canonical_emoji, token_id, score, reasons_json, scoring_version, rejected_at, rejected_by_fid, restored_at) VALUES (${sqlValue(match.emoji)}, ${match.tokenId}, ${sqlValue(match.score)}, ${sqlValue(match.reasonsJson)}, ${sqlValue(match.scoringVersion)}, ${sqlValue(match.rejectedAt)}, ${sqlValue(match.rejectedByFid)}, NULL);`);
  }
  const approvedByGroup = new Map();
  for (const match of seed.approvedMatches) approvedByGroup.set(match.emoji, (approvedByGroup.get(match.emoji) ?? 0) + 1);
  for (const group of seed.reviewedGroups) {
    lines.push(`UPDATE warpmoji_emoji_groups SET reviewed_at = ${sqlValue(group.reviewedAt)}, reviewed_by_fid = ${sqlValue(group.reviewedByFid)}, approved_count = ${approvedByGroup.get(group.emoji) ?? 0}, updated_at = CURRENT_TIMESTAMP WHERE canonical_emoji = ${sqlValue(group.emoji)};`);
  }
  lines.push(
    "UPDATE warpmoji_emoji_groups SET candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates c WHERE c.canonical_emoji = warpmoji_emoji_groups.canonical_emoji);",
    `INSERT INTO warpmoji_curated_seed_imports (checksum, seed_schema_version, unicode_version, scoring_versions_json, curation_updated_at, reviewed_group_count, approved_match_count, rejected_match_count) VALUES (${sqlValue(seed.checksum)}, ${seed.seedSchemaVersion}, ${sqlValue(seed.unicodeVersion)}, ${sqlValue(JSON.stringify(seed.scoringVersions))}, ${sqlValue(seed.curationUpdatedAt)}, ${seed.reviewedGroups.length}, ${seed.approvedMatches.length}, ${seed.rejectedMatches.length}) ON CONFLICT(checksum) DO UPDATE SET imported_at = CURRENT_TIMESTAMP;`,
    "",
  );
  return lines.join("\n");
}

function normalizeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function preflightTarget(seed, target) {
  const groupChunks = chunks(seed.reviewedGroups);
  const approvedChunks = chunks(seed.approvedMatches);
  const statements = [
    "SELECT unicode_version FROM warpmoji_emoji_groups GROUP BY unicode_version ORDER BY unicode_version",
    `SELECT scoring_version FROM warpmoji_candidates GROUP BY scoring_version
      UNION SELECT scoring_version FROM warpmoji_settings WHERE singleton = 1`,
    ...groupChunks.map((groupChunk) => `SELECT COUNT(*) AS count FROM warpmoji_emoji_groups WHERE canonical_emoji IN (${groupChunk.map((group) => sqlValue(group.emoji)).join(", ")})`),
    ...approvedChunks.map((matchChunk) => `SELECT COUNT(*) AS count FROM warpmoji_candidates WHERE ${matchChunk.map((match) => `(canonical_emoji = ${sqlValue(match.emoji)} AND token_id = ${match.tokenId})`).join(" OR ")}`),
  ];
  const results = queryBatches(target, statements);
  const catalog = results[0].map((row) => String(row.unicode_version));
  if (catalog.length !== 1 || catalog[0] !== seed.unicodeVersion) {
    throw new Error(`Target Unicode catalog (${catalog.join(", ") || "missing"}) does not match seed ${seed.unicodeVersion}. No curation data was changed.`);
  }
  const availableScoringVersions = new Set(results[1].map((row) => String(row.scoring_version)));
  const missingVersions = seed.scoringVersions.filter((version) => !availableScoringVersions.has(version));
  if (missingVersions.length) throw new Error(`Target is missing scoring version(s) ${missingVersions.join(", ")}. No curation data was changed.`);

  const foundGroups = results.slice(2, 2 + groupChunks.length).reduce((total, rows) => total + Number(rows[0]?.count ?? 0), 0);
  if (foundGroups !== seed.reviewedGroups.length) throw new Error(`Target contains ${foundGroups}/${seed.reviewedGroups.length} reviewed emoji groups from the seed. No curation data was changed.`);

  const foundApproved = results.slice(2 + groupChunks.length).reduce((total, rows) => total + Number(rows[0]?.count ?? 0), 0);
  if (foundApproved !== seed.approvedMatches.length) throw new Error(`Target contains ${foundApproved}/${seed.approvedMatches.length} approved candidate rows from the seed. No curation data was changed.`);
}

function exportSeed(outputPath) {
  const results = queryBatches("local", [
    `SELECT canonical_emoji, reviewed_at, reviewed_by_fid
      FROM warpmoji_emoji_groups WHERE reviewed_at IS NOT NULL ORDER BY canonical_emoji`,
    `SELECT canonical_emoji, token_id, assignment, scoring_version, reviewed_at, reviewed_by_fid, updated_at
      FROM warpmoji_candidates WHERE status = 'approved' ORDER BY canonical_emoji, token_id`,
    `SELECT canonical_emoji, token_id, score, reasons_json, scoring_version, rejected_at, rejected_by_fid
      FROM warpmoji_rejections WHERE restored_at IS NULL ORDER BY canonical_emoji, token_id`,
    "SELECT unicode_version FROM warpmoji_emoji_groups GROUP BY unicode_version ORDER BY unicode_version",
    "SELECT scoring_version FROM warpmoji_settings WHERE singleton = 1 LIMIT 1",
  ]);
  const reviewedGroups = results[0].map((row) => ({
      emoji: String(row.canonical_emoji), reviewedAt: String(row.reviewed_at), reviewedByFid: normalizeInteger(row.reviewed_by_fid),
    }));
  const approvedMatches = results[1].map((row) => ({
      emoji: String(row.canonical_emoji), tokenId: Number(row.token_id), assignment: row.assignment === "secondary" ? "secondary" : "primary",
      scoringVersion: String(row.scoring_version), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
      reviewedByFid: normalizeInteger(row.reviewed_by_fid), updatedAt: String(row.updated_at),
    }));
  const rejectedMatches = results[2].map((row) => ({
      emoji: String(row.canonical_emoji), tokenId: Number(row.token_id), score: Number(row.score), reasonsJson: String(row.reasons_json),
      scoringVersion: String(row.scoring_version), rejectedAt: String(row.rejected_at), rejectedByFid: normalizeInteger(row.rejected_by_fid),
    }));
  const unicodeVersions = results[3].map((row) => String(row.unicode_version));
  if (unicodeVersions.length !== 1) throw new Error(`Expected one Warpmoji Unicode catalog version; found ${unicodeVersions.join(", ") || "none"}.`);
  const timestamps = [
    ...reviewedGroups.map((row) => row.reviewedAt),
    ...approvedMatches.map((row) => row.updatedAt),
    ...rejectedMatches.map((row) => row.rejectedAt),
  ].filter(Boolean).sort();
  const scoringVersions = [...new Set([...approvedMatches, ...rejectedMatches].map((row) => row.scoringVersion))].sort();
  if (!scoringVersions.length) scoringVersions.push(String(results[4][0]?.scoring_version ?? "warpmoji-v1"));
  const payload = {
    seedSchemaVersion: SEED_SCHEMA_VERSION,
    unicodeVersion: unicodeVersions[0],
    scoringVersions,
    curationUpdatedAt: timestamps.at(-1) ?? null,
    reviewedGroups,
    approvedMatches,
    rejectedMatches,
  };
  const seed = { ...payload, checksum: checksum(payload) };
  validateSeed(seed);
  const sqlPath = outputPath.toLowerCase().endsWith(".json") ? outputPath.slice(0, -5) + ".sql" : `${outputPath}.sql`;
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  writeFileSync(sqlPath, seedSql(seed), "utf8");
  console.log(`Exported Warpmoji curated seed ${seed.checksum}`);
  console.log(`  Reviewed groups: ${reviewedGroups.length}`);
  console.log(`  Approved matches: ${approvedMatches.length}`);
  console.log(`  Rejected matches: ${rejectedMatches.length}`);
  console.log(`  JSON: ${relative(ROOT, outputPath)}`);
  console.log(`  SQL:  ${relative(ROOT, sqlPath)}`);
}

function importSeed(inputPath, target, dryRun, confirmation) {
  if (!["local", "preview", "production"].includes(target)) usage("Import requires --target local, preview or production.");
  if (target === "production" && confirmation !== "IMPORT_WARPMOJI_CURATED_SEED") {
    throw new Error("Production import refused. Re-run with --confirm-production IMPORT_WARPMOJI_CURATED_SEED after reviewing the seed checksum and backup.");
  }
  const seed = validateSeed(JSON.parse(readFileSync(inputPath, "utf8")));
  const sql = seedSql(seed);
  console.log(`Validated Warpmoji curated seed ${seed.checksum} for ${target}.`);
  console.log(`This will replace curation state with ${seed.reviewedGroups.length} reviewed groups, ${seed.approvedMatches.length} approvals and ${seed.rejectedMatches.length} active rejections.`);
  preflightTarget(seed, target);
  console.log(`Target ${target} catalog preflight passed.`);
  if (dryRun) {
    console.log("Dry run complete; D1 was not modified.");
    return;
  }
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "warpmoji-seed-"));
  const sqlPath = join(temporaryDirectory, "curated-seed.sql");
  try {
    writeFileSync(sqlPath, sql, "utf8");
    if (target === "local") {
      const db = new DatabaseSync(localDatabasePath());
      try {
        db.exec(`BEGIN IMMEDIATE;\n${sql}\nCOMMIT;`);
      } catch (error) {
        try { db.exec("ROLLBACK;"); } catch { /* transaction may not have started */ }
        throw error;
      } finally {
        db.close();
      }
    } else {
      const locationArgs = target === "preview"
        ? ["--remote", "--env", "preview"]
        : ["--remote"];
      process.stdout.write(runWrangler(["d1", "execute", "WARPLETS", ...locationArgs, "--file", sqlPath]));
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const escapedChecksum = seed.checksum.replaceAll("'", "''");
  const counts = query(target, `SELECT
    (SELECT COUNT(*) FROM warpmoji_emoji_groups WHERE reviewed_at IS NOT NULL) AS reviewed_groups,
    (SELECT COUNT(*) FROM warpmoji_candidates WHERE status = 'approved') AS approved_matches,
    (SELECT COUNT(*) FROM warpmoji_rejections WHERE restored_at IS NULL) AS rejected_matches,
    (SELECT COUNT(*) FROM warpmoji_curated_seed_imports WHERE checksum = '${escapedChecksum}') AS receipt_count`)[0];
  const expected = [seed.reviewedGroups.length, seed.approvedMatches.length, seed.rejectedMatches.length, 1];
  const actual = [counts?.reviewed_groups, counts?.approved_matches, counts?.rejected_matches, counts?.receipt_count].map(Number);
  if (actual.some((value, index) => value !== expected[index])) throw new Error(`Post-import verification failed. Expected ${expected.join("/")}; received ${actual.join("/")}.`);
  console.log(`Imported and verified Warpmoji curated seed on ${target}.`);
}

const options = parseArgs(process.argv.slice(2));
try {
  if (options.command === "export") exportSeed(options.output);
  else if (options.command === "import") importSeed(options.input, options.target, options.dryRun, options.confirmation);
  else usage("Choose export or import.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
