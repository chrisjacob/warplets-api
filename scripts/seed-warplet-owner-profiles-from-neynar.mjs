import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(repoRoot, "app");
const generatedDir = path.join(repoRoot, "scripts", "generated");
const outputSqlPath = path.join(generatedDir, "warplet-owner-profile-neynar-seed.local.sql");
const outputJsonPath = path.join(generatedDir, "warplet-owner-profile-neynar-seed.local.json");
const missingQueryPath = path.join(generatedDir, "warplet-owner-profile-missing.local.sql");
const DEFAULT_LIMIT = 10000;
const DEFAULT_BATCH_SIZE = 25;
const VIEWER_FID = 1129138;

function readDevVar(name) {
  const raw = readFileSync(path.join(appDir, ".dev.vars"), "utf8");
  const line = raw.split(/\r?\n/).find((entry) => entry.trim().startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
}

function parseArg(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return fallback;
  const parsed = Number(arg.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function runWrangler(args) {
  const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const result = process.platform === "win32"
    ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& pnpm --dir app exec wrangler ${args.map(psQuote).join(" ")}`,
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 100,
    })
    : spawnSync("pnpm", ["--dir", "app", "exec", "wrangler", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 100,
    });
  if (result.status !== 0) {
    const trim = (value) => value && value.length > 4000 ? `${value.slice(0, 4000)}\n...truncated...` : value;
    throw new Error([
      `wrangler command failed with status ${result.status}`,
      result.error?.message,
      trim(result.stderr),
      trim(result.stdout),
    ].filter(Boolean).join("\n"));
  }
  return result.stdout;
}

function parseWranglerJson(stdout) {
  const parsed = JSON.parse(stdout);
  return parsed.flatMap((statement) => Array.isArray(statement.results) ? statement.results : []);
}

function sqlString(value) {
  if (value == null || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "NULL";
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeWallet(value) {
  return asString(value)?.toLowerCase() ?? "";
}

function extractUsersForWallet(payload, wallet) {
  const lower = wallet.toLowerCase();
  const direct = asArray(payload[lower]) || asArray(payload[wallet]);
  if (direct.length) return direct;
  const result = asObject(payload.result);
  const resultUsers = result ? asArray(result[lower]) || asArray(result[wallet]) : [];
  if (resultUsers.length) return resultUsers;
  const users = asArray(payload.users);
  return users.filter((user) => {
    const obj = asObject(user);
    const addresses = asObject(obj?.verified_addresses);
    const ethAddresses = [
      ...asArray(addresses?.eth_addresses),
      ...asArray(asObject(addresses?.primary)?.eth_address ? [asObject(addresses?.primary)?.eth_address] : []),
    ].map((address) => normalizeWallet(address));
    return ethAddresses.includes(lower);
  });
}

function normalizeUser(user) {
  const obj = asObject(user);
  if (!obj) return null;
  const fid = asNumber(obj.fid);
  if (!fid || !Number.isInteger(fid)) return null;
  const profile = asObject(obj.profile);
  const bio = asObject(profile?.bio);
  return {
    fid,
    score: asNumber(obj.score),
    username: asString(obj.username),
    displayName: asString(obj.display_name),
    pfpUrl: asString(obj.pfp_url),
    bio: asString(bio?.text) ?? asString(obj.profile_bio_text),
    followerCount: asNumber(obj.follower_count),
    followingCount: asNumber(obj.following_count),
  };
}

function chooseUser(users, expectedFid) {
  const normalized = users.map(normalizeUser).filter(Boolean);
  return normalized.find((user) => user.fid === expectedFid)
    ?? normalized.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.fid - b.fid)[0]
    ?? null;
}

async function fetchBatch(apiKey, rows) {
  const addresses = rows.map((row) => row.wallet).join(",");
  const url = new URL("https://api.neynar.com/v2/farcaster/user/bulk-by-address");
  url.searchParams.set("addresses", addresses);
  url.searchParams.set("viewer_fid", String(VIEWER_FID));
  const response = await fetch(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Neynar bulk-by-address failed (${response.status})`);
  }
  const payload = await response.json();
  return rows.map((row) => {
    const user = chooseUser(extractUsersForWallet(payload, row.wallet), Number(row.fid));
    return user ? { ...row, ...user } : { ...row, missing: true };
  });
}

function buildSeedSql(rows) {
  const statements = [
    "-- Generated by scripts/seed-warplet-owner-profiles-from-neynar.mjs",
    `-- Generated at ${new Date().toISOString()}`,
    "-- Public Farcaster profile cache for wallet_farcaster_links.",
    "",
  ];

  for (const row of rows) {
    if (row.missing) continue;
    statements.push(`INSERT OR IGNORE INTO wallet_farcaster_links (
  wallet, fid, score, username, display_name, pfp_url, profile_bio_text,
  follower_count, following_count, fetched_at
) VALUES (
  ${sqlString(row.wallet)}, ${sqlNumber(row.fid)}, ${sqlNumber(row.score)}, ${sqlString(row.username)},
  ${sqlString(row.displayName)}, ${sqlString(row.pfpUrl)}, ${sqlString(row.bio)},
  ${sqlNumber(row.followerCount)}, ${sqlNumber(row.followingCount)}, CURRENT_TIMESTAMP
);`);
    statements.push(`UPDATE wallet_farcaster_links SET
  score = COALESCE(${sqlNumber(row.score)}, score),
  username = COALESCE(${sqlString(row.username)}, username),
  display_name = COALESCE(${sqlString(row.displayName)}, display_name),
  pfp_url = COALESCE(${sqlString(row.pfpUrl)}, pfp_url),
  profile_bio_text = COALESCE(${sqlString(row.bio)}, profile_bio_text),
  follower_count = COALESCE(${sqlNumber(row.followerCount)}, follower_count),
  following_count = COALESCE(${sqlNumber(row.followingCount)}, following_count),
  fetched_at = CURRENT_TIMESTAMP
WHERE wallet = ${sqlString(row.wallet)} AND fid = ${sqlNumber(row.fid)};`);
  }

  return statements.join("\n");
}

async function main() {
  const apiKey = process.env.NEYNAR_API_KEY || readDevVar("NEYNAR_API_KEY");
  if (!apiKey) throw new Error("NEYNAR_API_KEY not found in environment or app/.dev.vars");

  const limit = parseArg("limit", DEFAULT_LIMIT);
  const batchSize = Math.min(parseArg("batch-size", DEFAULT_BATCH_SIZE), 50);
  const noApply = hasFlag("no-apply");
  mkdirSync(generatedDir, { recursive: true });

  const query = `
    SELECT wallet, fid, username
    FROM wallet_farcaster_links
    WHERE wallet IS NOT NULL
      AND fid IS NOT NULL
      AND (pfp_url IS NULL OR profile_bio_text IS NULL OR follower_count IS NULL OR following_count IS NULL)
    ORDER BY fid ASC
    LIMIT ${limit}
  `;
  writeFileSync(missingQueryPath, query);
  const rows = parseWranglerJson(runWrangler([
    "d1", "execute", "warplets", "--local", "--json", "--file", path.relative(appDir, missingQueryPath),
  ])).map((row) => ({ wallet: normalizeWallet(row.wallet), fid: Number(row.fid), username: row.username ?? null }))
    .filter((row) => row.wallet && Number.isInteger(row.fid));

  const enriched = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const result = await fetchBatch(apiKey, batch);
    enriched.push(...result);
    console.log(`Fetched ${Math.min(index + batch.length, rows.length)} / ${rows.length}`);
  }

  writeFileSync(outputJsonPath, JSON.stringify(enriched, null, 2));
  writeFileSync(outputSqlPath, buildSeedSql(enriched));

  const matched = enriched.filter((row) => !row.missing).length;
  console.log(`Matched ${matched} / ${enriched.length}`);
  console.log(`Wrote ${path.relative(repoRoot, outputSqlPath)}`);
  console.log(`Wrote ${path.relative(repoRoot, outputJsonPath)}`);

  if (!noApply && matched > 0) {
    runWrangler(["d1", "execute", "warplets", "--local", "--file", path.relative(appDir, outputSqlPath)]);
    console.log("Applied generated seed SQL to local D1.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
