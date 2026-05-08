import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = process.cwd();
const WORK_DIR = path.join(ROOT, ".wrangler", "best-friends-backfill");
const CHECKPOINT_PATH = path.join(WORK_DIR, "progress.json");
const BATCH_SQL_PATH = path.join(WORK_DIR, "batch.sql");
const LOG_PATH = path.join(WORK_DIR, "backfill.log");

const DATABASE_NAME = "warplets";
const DEFAULT_DELAY_MS = 250;
const USERS_PER_INSERT_BATCH = 10;
const BEST_FRIEND_LIMIT = 100;

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const delayMs = Number.parseInt(argValue("delay-ms", String(DEFAULT_DELAY_MS)), 10);
const maxUsersArg = argValue("max-users", "");
const maxUsers = maxUsersArg ? Number.parseInt(maxUsersArg, 10) : Number.POSITIVE_INFINITY;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  return writeFile(LOG_PATH, `${line}\n`, { flag: "a" });
}

async function readDevVar(name) {
  for (const file of [".dev.vars", path.join("app", ".dev.vars")]) {
    if (!existsSync(path.join(ROOT, file))) continue;
    const text = await readFile(path.join(ROOT, file), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      if (trimmed.slice(0, index) === name) return trimmed.slice(index + 1);
    }
  }

  return process.env[name] || "";
}

function spawnWranglerD1(args) {
  const executable =
    process.platform === "win32"
      ? path.join(ROOT, "node_modules", ".bin", "wrangler.CMD")
      : path.join(ROOT, "node_modules", ".bin", "wrangler");

  const wranglerArgs = ["d1", "execute", DATABASE_NAME, "--remote", ...args];
  const result =
    process.platform === "win32"
      ? spawnSync(`call ${[executable, ...wranglerArgs].map(cmdQuote).join(" ")}`, {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 25,
          shell: true,
        })
      : spawnSync(executable, wranglerArgs, {
          cwd: ROOT,
          encoding: "utf8",
          maxBuffer: 1024 * 1024 * 25,
        });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`wrangler failed (${result.status}): ${result.stderr || result.stdout}`);
  }

  return result;
}

function runWranglerD1(args) {
  const result = spawnWranglerD1(["--json", ...args]);
  return JSON.parse(result.stdout);
}

function cmdQuote(value) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function d1Query(command) {
  const payload = runWranglerD1(["--command", command]);
  const first = payload[0];
  if (!first?.success) throw new Error(`D1 query failed: ${JSON.stringify(payload)}`);
  return first.results ?? [];
}

async function d1ExecuteFile(sql) {
  await writeFile(BATCH_SQL_PATH, sql, "utf8");
  return spawnWranglerD1(["--file", BATCH_SQL_PATH]);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "NULL";
}

function loadCheckpointSync() {
  if (!existsSync(CHECKPOINT_PATH)) return { processedFids: [], failed: [] };
  const text = readFileSync(CHECKPOINT_PATH, "utf8");
  return JSON.parse(text);
}

async function saveCheckpoint(checkpoint) {
  await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), "utf8");
}

function normalizeBestFriends(payload) {
  const users = Array.isArray(payload?.users) ? payload.users : [];
  return users
    .map((user) => {
      if (!user || typeof user !== "object") return null;
      const fid = user.fid;
      const username = typeof user.username === "string" ? user.username : "";
      const score = user.mutual_affinity_score;
      if (typeof fid !== "number" || !Number.isFinite(fid)) return null;
      if (!username.trim()) return null;
      if (typeof score !== "number" || !Number.isFinite(score)) return null;
      return { fid, username, mutualAffinityScore: score };
    })
    .filter(Boolean);
}

async function fetchBestFriends(fid, apiKey) {
  const endpoint = `https://api.neynar.com/v2/farcaster/user/best_friends?fid=${fid}&limit=${BEST_FRIEND_LIMIT}`;
  const res = await fetch(endpoint, { headers: { "x-api-key": apiKey } });
  if (res.status === 429) {
    throw new Error("Neynar rate limited this request");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Neynar ${res.status}: ${body.slice(0, 240)}`);
  }
  return normalizeBestFriends(await res.json());
}

function buildInsertSql(rows) {
  if (rows.length === 0) return "";

  const values = rows
    .map((row) =>
      [
        row.userId,
        row.userFid,
        row.bestFriendFid,
        sqlNumber(row.mutualAffinityScore),
        sqlString(row.username),
        sqlString(row.fetchedAt),
      ].join(", ")
    )
    .map((tuple) => `(${tuple})`)
    .join(",\n");

  return `INSERT INTO warplets_user_best_friends
  (user_id, user_fid, best_friend_fid, mutual_affinity_score, username, fetched_at)
VALUES
${values}
ON CONFLICT(user_id, best_friend_fid) DO UPDATE SET
  user_fid = excluded.user_fid,
  mutual_affinity_score = excluded.mutual_affinity_score,
  username = excluded.username,
  fetched_at = excluded.fetched_at;`;
}

async function main() {
  await mkdir(WORK_DIR, { recursive: true });

  const apiKey = await readDevVar("NEYNAR_API_KEY");
  if (!apiKey) throw new Error("NEYNAR_API_KEY was not found in env, .dev.vars, or app/.dev.vars");

  await log("Loading users and existing best-friend cache state...");
  const users = d1Query("SELECT id, fid FROM warplets_users WHERE fid IS NOT NULL ORDER BY id;")
    .map((row) => ({ id: Number(row.id), fid: Number(row.fid) }))
    .filter((row) => Number.isInteger(row.id) && Number.isInteger(row.fid));

  const existing = new Set(
    d1Query("SELECT DISTINCT user_fid FROM warplets_user_best_friends WHERE user_fid IS NOT NULL;")
      .map((row) => Number(row.user_fid))
      .filter((fid) => Number.isInteger(fid))
  );

  const checkpoint = loadCheckpointSync();
  const processed = new Set(checkpoint.processedFids ?? []);
  const failed = Array.isArray(checkpoint.failed) ? checkpoint.failed : [];
  const candidates = users.filter((user) => !existing.has(user.fid) && !processed.has(user.fid)).slice(0, maxUsers);

  await log(`Users=${users.length}; existing=${existing.size}; checkpointProcessed=${processed.size}; candidates=${candidates.length}`);

  let pendingRows = [];
  let pendingFids = [];
  let completedThisRun = 0;
  let insertedRows = 0;

  async function flush() {
    if (pendingRows.length === 0 && pendingFids.length === 0) return;

    if (pendingRows.length > 0) {
      await d1ExecuteFile(buildInsertSql(pendingRows));
      insertedRows += pendingRows.length;
    }

    pendingFids.forEach((fid) => processed.add(fid));
    await saveCheckpoint({ processedFids: [...processed], failed });
    await log(`Flushed users=${pendingFids.length}; insertedRows=${pendingRows.length}; totalCompleted=${completedThisRun}; totalInserted=${insertedRows}`);
    pendingRows = [];
    pendingFids = [];
  }

  for (const user of candidates) {
    try {
      const friends = await fetchBestFriends(user.fid, apiKey);
      const fetchedAt = new Date().toISOString();
      pendingRows.push(
        ...friends.map((friend) => ({
          userId: user.id,
          userFid: user.fid,
          bestFriendFid: friend.fid,
          mutualAffinityScore: friend.mutualAffinityScore,
          username: friend.username,
          fetchedAt,
        }))
      );
      pendingFids.push(user.fid);
      completedThisRun += 1;

      await log(`Fetched fid=${user.fid}; friends=${friends.length}; completed=${completedThisRun}/${candidates.length}`);

      if (pendingFids.length >= USERS_PER_INSERT_BATCH) {
        await flush();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ fid: user.fid, userId: user.id, message, at: new Date().toISOString() });
      await saveCheckpoint({ processedFids: [...processed], failed });
      await log(`FAILED fid=${user.fid}; ${message}`);
    }

    if (Number.isFinite(delayMs) && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  await flush();
  await log(`Done. completedThisRun=${completedThisRun}; insertedRows=${insertedRows}; failures=${failed.length}`);
}

main().catch(async (error) => {
  await mkdir(WORK_DIR, { recursive: true }).catch(() => {});
  await log(`FATAL ${(error instanceof Error ? error.stack || error.message : String(error))}`).catch(() => {});
  process.exitCode = 1;
});
