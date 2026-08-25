import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..");
const appDir = path.join(repoRoot, "app");
const cachePath = path.join(repoRoot, "scripts", "generated", "warplet-owner-profile-neynar-seed.local.json");
const apply = process.argv.includes("--apply");
const batchSize = 250;

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args) {
  const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const result = process.platform === "win32"
    ? spawnSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `& pnpm exec wrangler ${args.map(psQuote).join(" ")}`,
    ], { cwd: appDir, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 })
    : spawnSync("pnpm", ["exec", "wrangler", ...args], {
      cwd: appDir,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    });
  if (result.status !== 0) {
    throw new Error([result.stderr, result.stdout].filter(Boolean).join("\n").slice(0, 8000));
  }
  return result.stdout;
}

function wranglerRows(sql) {
  const command = sql.replace(/\s+/g, " ").trim();
  const output = runWrangler(["d1", "execute", "warplets", "--remote", "--json", "--command", command]);
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Wrangler returned no JSON result set");
  return JSON.parse(output.slice(start, end + 1)).flatMap((statement) => statement.results ?? []);
}

const missing = wranglerRows(`
  WITH ranked AS (
    SELECT LOWER(wallet) wallet, fid, username, pfp_url,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(wallet)
        ORDER BY COALESCE(score, -1) DESC, fid ASC
      ) profile_rank
    FROM wallet_farcaster_links
  )
  SELECT r.wallet, r.fid, r.username
  FROM holder_leaderboard h
  JOIN ranked r ON r.wallet = LOWER(h.wallet) AND r.profile_rank = 1
  WHERE r.pfp_url IS NULL OR TRIM(r.pfp_url) = ''
  ORDER BY r.fid ASC
`);

const cached = JSON.parse(readFileSync(cachePath, "utf8"));
const byIdentity = new Map(cached
  .filter((row) => row.wallet && Number.isInteger(row.fid) && typeof row.pfpUrl === "string" && row.pfpUrl.trim())
  .map((row) => [`${row.wallet.toLowerCase()}|${row.fid}`, row.pfpUrl.trim()]));
const repairs = missing.flatMap((row) => {
  const pfpUrl = byIdentity.get(`${String(row.wallet).toLowerCase()}|${Number(row.fid)}`);
  return pfpUrl ? [{ ...row, pfpUrl }] : [];
});

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", missing: missing.length, matched: repairs.length, unmatched: missing.length - repairs.length }, null, 2));
if (!apply || repairs.length === 0) process.exit(0);

for (let offset = 0; offset < repairs.length; offset += batchSize) {
  const batch = repairs.slice(offset, offset + batchSize);
  const sql = [
    ...batch.map((row) => `UPDATE wallet_farcaster_links
SET pfp_url = ${quote(row.pfpUrl)}
WHERE LOWER(wallet) = ${quote(String(row.wallet).toLowerCase())}
  AND fid = ${Number(row.fid)}
  AND (pfp_url IS NULL OR TRIM(pfp_url) = '');`),
  ].join("\n");
  const file = path.join(tmpdir(), `10x-profile-image-repair-${process.pid}-${offset}.sql`);
  try {
    writeFileSync(file, sql, { mode: 0o600 });
    runWrangler(["d1", "execute", "warplets", "--remote", "--file", file]);
  } finally {
    rmSync(file, { force: true });
  }
  console.log(`Repaired ${Math.min(offset + batch.length, repairs.length)} / ${repairs.length}`);
}

const remaining = wranglerRows(`
  WITH ranked AS (
    SELECT LOWER(wallet) wallet, fid, pfp_url,
      ROW_NUMBER() OVER (PARTITION BY LOWER(wallet) ORDER BY COALESCE(score, -1) DESC, fid ASC) profile_rank
    FROM wallet_farcaster_links
  )
  SELECT COUNT(*) AS count
  FROM holder_leaderboard h
  JOIN ranked r ON r.wallet = LOWER(h.wallet) AND r.profile_rank = 1
  WHERE r.pfp_url IS NULL OR TRIM(r.pfp_url) = ''
`);
console.log(JSON.stringify({ remaining: Number(remaining[0]?.count) || 0 }));
