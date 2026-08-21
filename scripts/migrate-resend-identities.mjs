import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SEGMENTS = {
  tenx: "ae46cf43-d4cf-4bc6-bc42-8af13fbc0dd7",
  drop: "e52bdc31-4f3c-4ec6-a623-9bc3977042e2",
  discord: "be2dd809-e0bd-4b71-95ac-eb11f68270c4",
};
const PROPERTY_KEYS = ["FarcasterFID", "FarcasterUsername", "DiscordUserID", "DiscordName", "Wallet"];
const root = resolve(import.meta.dirname, "..");
const requestedEnvFile = process.argv.find((value) => value.startsWith("--env-file="))?.split("=")[1];
const envFile = requestedEnvFile
  || [resolve(root, ".dev.vars.identity-migration"), resolve(root, "app", ".dev.vars")].find(existsSync);
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);
const apply = process.argv.includes("--apply");
const skipNeynar = process.argv.includes("--skip-neynar");
const database = process.argv.find((value) => value.startsWith("--database="))?.split("=")[1] || "warplets";
const apiKey = process.env.RESEND_API_KEY?.trim();
const neynarApiKey = process.env.NEYNAR_API_KEY?.trim();
const appDirectory = resolve(root, "app");
const counters = {
  trusted: 0, changed: 0, unchanged: 0, legacyUnverified: 0,
  replaced: 0, unresolved: 0, failed: 0,
};

if (!apiKey) throw new Error("RESEND_API_KEY must be set in this terminal");
if (!skipNeynar && !neynarApiKey) {
  console.warn("[identity-migration] NEYNAR_API_KEY is absent; unresolved wallets will be reported without Neynar fallback.");
}

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
let lastResendRequestAt = 0;

async function resend(path, init = {}, attempt = 0) {
  const gap = 550 - (Date.now() - lastResendRequestAt);
  if (gap > 0) await wait(gap);
  lastResendRequestAt = Date.now();
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 429 && attempt < 8) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) ? Math.max(1_000, retryAfter * 1_000) : Math.min(60_000, 2 ** attempt * 1_000));
    return resend(path, init, attempt + 1);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Resend ${init.method || "GET"} ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

async function paginated(path) {
  const rows = [];
  let after = "";
  do {
    const separator = path.includes("?") ? "&" : "?";
    const page = await resend(`${path}${separator}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    const data = Array.isArray(page.data) ? page.data : [];
    rows.push(...data);
    after = page.has_more && data.length ? String(data.at(-1).id || "") : "";
  } while (after);
  return rows;
}

async function verifyProperties() {
  const definitions = await paginated("/contact-properties");
  const byKey = new Map(definitions.map((property) => [property.key, property.type]));
  const invalid = PROPERTY_KEYS.filter((key) => byKey.get(key) !== "string");
  if (invalid.length) {
    throw new Error(`Resend property validation failed. Missing or non-string keys: ${invalid.join(", ")}`);
  }
}

function wranglerSql(sql) {
  const wranglerEntry = resolve(appDirectory, "node_modules", "wrangler", "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [
    wranglerEntry, "d1", "execute", database, "--remote", "--json", "--command", sql,
  ], { cwd: appDirectory, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error((result.error?.message || result.stderr || result.stdout || "Remote D1 command failed").trim());
  }
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);
}

function sqlString(value) {
  return value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
}

function loadTrustedFarcasterRows() {
  return wranglerSql(`SELECT
      lower(trim(e.email)) AS email,
      e.fid AS farcaster_fid,
      COALESCE(NULLIF(trim(u.username), ''), NULLIF(trim(e.username), '')) AS farcaster_username,
      (SELECT lower(trim(a.wallet_address)) FROM app_identity_links a
        WHERE a.farcaster_fid = e.fid ORDER BY a.verified_at DESC LIMIT 1) AS app_wallet,
      NULLIF(lower(trim(u.primary_eth_address)), '') AS primary_wallet,
      (SELECT lower(trim(w.wallet)) FROM wallet_farcaster_links w
        WHERE w.fid = e.fid ORDER BY COALESCE(w.score, -1) DESC, w.wallet ASC LIMIT 1) AS linked_wallet
    FROM email_waitlist e
    LEFT JOIN warplets_users u ON u.fid = e.fid
    WHERE e.verified = 1 AND e.fid IS NOT NULL AND e.fid > 0`);
}

function wallet(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^0x[a-f0-9]{40}$/.test(normalized) ? normalized : null;
}

async function neynarWallets(fids) {
  const result = new Map();
  if (!neynarApiKey || skipNeynar) return result;
  for (let index = 0; index < fids.length; index += 100) {
    const batch = fids.slice(index, index + 100);
    const response = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk/?fids=${batch.join(",")}`, {
      headers: { "x-api-key": neynarApiKey },
    });
    if (!response.ok) throw new Error(`Neynar bulk lookup failed (${response.status})`);
    const payload = await response.json();
    for (const user of payload.users ?? []) {
      const primary = wallet(user?.verified_addresses?.primary?.eth_address);
      if (Number.isInteger(user?.fid) && primary) result.set(Number(user.fid), primary);
    }
  }
  return result;
}

function stringProperty(properties, key) {
  const raw = properties?.[key];
  const value = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
  return value == null ? null : String(value).trim() || null;
}

function samePatch(contact, patch) {
  if ((patch.first_name ?? null) !== (contact.first_name ?? null)) return false;
  if ((patch.last_name ?? null) !== (contact.last_name ?? null)) return false;
  return Object.entries(patch.properties).every(([key, value]) => stringProperty(contact.properties, key) === value);
}

function persistCanonicalProfiles(rows) {
  if (!apply || !rows.length) return;
  for (let index = 0; index < rows.length; index += 20) {
    const statements = rows.slice(index, index + 20).map((row) => {
      const now = new Date().toISOString();
      return `INSERT INTO email_identity_profiles (
          email, farcaster_fid, farcaster_username, discord_user_id, discord_name, wallet,
          email_verified_at, created_at, updated_at
        ) VALUES (${sqlString(row.email)}, ${row.farcasterFid ?? "NULL"}, ${sqlString(row.farcasterUsername)},
          ${sqlString(row.discordUserId)}, ${sqlString(row.discordName)}, ${sqlString(row.wallet)},
          ${sqlString(now)}, ${sqlString(now)}, ${sqlString(now)})
        ON CONFLICT(email) DO UPDATE SET
          farcaster_fid = COALESCE(email_identity_profiles.farcaster_fid, excluded.farcaster_fid),
          farcaster_username = CASE
            WHEN email_identity_profiles.farcaster_fid IS NULL OR email_identity_profiles.farcaster_fid = excluded.farcaster_fid
            THEN COALESCE(excluded.farcaster_username, email_identity_profiles.farcaster_username)
            ELSE email_identity_profiles.farcaster_username END,
          discord_user_id = COALESCE(email_identity_profiles.discord_user_id, excluded.discord_user_id),
          discord_name = CASE
            WHEN email_identity_profiles.discord_user_id IS NULL OR email_identity_profiles.discord_user_id = excluded.discord_user_id
            THEN COALESCE(excluded.discord_name, email_identity_profiles.discord_name)
            ELSE email_identity_profiles.discord_name END,
          wallet = COALESCE(email_identity_profiles.wallet, excluded.wallet), updated_at = excluded.updated_at;
        ${row.discordUserId ? `INSERT OR IGNORE INTO email_identity_memberships
          (email, segment_id, source, confirmed_at, updated_at) VALUES
          (${sqlString(row.email)}, ${sqlString(SEGMENTS.discord)}, 'legacy_discord_otp', ${sqlString(now)}, ${sqlString(now)});` : ""}`;
    });
    wranglerSql(statements.join("\n"));
  }
}

async function main() {
  console.log(`[identity-migration] Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  await verifyProperties();
  console.log("[identity-migration] Resend property definitions verified.");

  const memberships = new Map();
  const contacts = new Map();
  for (const segmentId of Object.values(SEGMENTS)) {
    const rows = await paginated(`/segments/${segmentId}/contacts`);
    for (const row of rows) {
      const email = String(row.email || "").trim().toLowerCase();
      if (!email) continue;
      contacts.set(email, row);
      if (!memberships.has(email)) memberships.set(email, new Set());
      memberships.get(email).add(segmentId);
    }
  }
  console.log(`[identity-migration] Deduplicated contact union: ${contacts.size}`);

  const farcasterRows = loadTrustedFarcasterRows();
  const farcasterByEmail = new Map(farcasterRows.map((row) => [String(row.email), row]));
  const unresolvedFids = [...new Set(farcasterRows
    .filter((row) => !wallet(row.app_wallet) && !wallet(row.primary_wallet) && !wallet(row.linked_wallet))
    .map((row) => Number(row.farcaster_fid)).filter(Number.isInteger))];
  const neynarByFid = await neynarWallets(unresolvedFids);

  const snapshot = [];
  const canonicalRows = [];
  let processed = 0;
  for (const [email] of contacts) {
    try {
      const contact = await resend(`/contacts/${encodeURIComponent(email)}`);
      const fc = farcasterByEmail.get(email);
      const discordMember = memberships.get(email)?.has(SEGMENTS.discord) === true;
      const discordUserId = discordMember
        ? stringProperty(contact.properties, "DiscordUserID") || (/^\d{15,22}$/.test(String(contact.last_name || "")) ? String(contact.last_name) : null)
        : null;
      const discordName = discordUserId
        ? stringProperty(contact.properties, "DiscordName") || String(contact.first_name || "").trim() || null
        : null;
      if (!fc && !discordUserId) {
        counters.legacyUnverified += 1;
        continue;
      }
      counters.trusted += 1;
      const farcasterFid = fc ? Number(fc.farcaster_fid) : null;
      const farcasterUsername = fc ? String(fc.farcaster_username || "").trim() || null : null;
      const resolvedWallet = fc
        ? wallet(fc.app_wallet) || wallet(fc.primary_wallet) || wallet(fc.linked_wallet) || neynarByFid.get(farcasterFid) || null
        : null;
      if (fc && !resolvedWallet) counters.unresolved += 1;
      const desiredProperties = {
        ...(farcasterFid ? { FarcasterFID: String(farcasterFid) } : {}),
        ...(farcasterUsername ? { FarcasterUsername: farcasterUsername } : {}),
        ...(discordUserId ? { DiscordUserID: discordUserId } : {}),
        ...(discordName ? { DiscordName: discordName } : {}),
        ...(resolvedWallet ? { Wallet: resolvedWallet } : {}),
      };
      const names = farcasterFid && farcasterUsername
        ? { first_name: farcasterUsername, last_name: String(farcasterFid) }
        : discordUserId && discordName
          ? { first_name: discordName, last_name: discordUserId }
          : { first_name: contact.first_name, last_name: contact.last_name };
      const patch = { ...names, properties: desiredProperties };
      const replacements = [
        ["FarcasterFID", desiredProperties.FarcasterFID],
        ["DiscordUserID", desiredProperties.DiscordUserID],
      ].some(([key, value]) => value && stringProperty(contact.properties, key) && stringProperty(contact.properties, key) !== value);
      if (replacements) counters.replaced += 1;
      const unchanged = samePatch(contact, patch);
      if (unchanged) counters.unchanged += 1;
      else counters.changed += 1;
      snapshot.push({ email, contact, memberships: [...(memberships.get(email) ?? [])], proposed: patch, unchanged });
      canonicalRows.push({ email, farcasterFid, farcasterUsername, discordUserId, discordName, wallet: resolvedWallet });
    } catch (error) {
      counters.failed += 1;
      console.error(`[identity-migration] Failed ${email}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      processed += 1;
      if (processed % 100 === 0 || processed === contacts.size) {
        console.log(`[identity-migration] Inspected ${processed}/${contacts.size} contacts.`);
      }
    }
  }

  const snapshotDirectory = resolve(root, "tmp");
  mkdirSync(snapshotDirectory, { recursive: true });
  const snapshotPath = resolve(snapshotDirectory, `resend-identity-rollback-${new Date().toISOString().replaceAll(":", "-")}.json`);
  writeFileSync(snapshotPath, JSON.stringify({ createdAt: new Date().toISOString(), apply, database, counters, contacts: snapshot }, null, 2));
  if (apply) {
    console.log(`[identity-migration] Rollback snapshot saved before mutations: ${snapshotPath}`);
    for (const row of snapshot) {
      if (row.unchanged) continue;
      try {
        await resend(`/contacts/${encodeURIComponent(row.email)}`, {
          method: "PATCH",
          body: JSON.stringify(row.proposed),
        });
      } catch (error) {
        counters.failed += 1;
        console.error(`[identity-migration] Update failed ${row.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  persistCanonicalProfiles(canonicalRows);
  console.log(`[identity-migration] Rollback snapshot: ${snapshotPath}`);
  console.log(`[identity-migration] Counts: ${JSON.stringify(counters)}`);
  if (!apply) console.log("[identity-migration] No contacts were changed. Re-run with --apply after reviewing the snapshot and counts.");
  if (counters.failed) process.exitCode = 1;
}

await main();
