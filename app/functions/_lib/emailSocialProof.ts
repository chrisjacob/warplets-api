import { outboundFetch } from "./outbound.js";
import { listResendSubscriberMembers } from "./resendIdentity.js";

export interface EmailSocialProofEnv {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  NEYNAR_API_KEY?: string;
}

export interface EmailSocialProofProfile {
  fid: number;
  username: string | null;
  pfpUrl: string;
}

export interface EmailSocialProofResult {
  subscriberCount: number;
  profiles: EmailSocialProofProfile[];
}

type StoredProfile = {
  fid: number;
  username: string | null;
  pfp_url: string;
  follower_count: number | null;
};

const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const RECONCILE_RETRY_MS = 60 * 60 * 1_000;

function cleanProfileRows(value: unknown): StoredProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const fid = Number(row.fid);
    const pfpUrl = typeof row.pfp_url === "string" ? row.pfp_url.trim() : "";
    if (!Number.isSafeInteger(fid) || fid <= 0 || !pfpUrl) return [];
    const followerCount = Number(row.follower_count);
    return [{
      fid,
      username: typeof row.username === "string" && row.username.trim() ? row.username.trim() : null,
      pfp_url: pfpUrl,
      follower_count: Number.isFinite(followerCount) && followerCount >= 0 ? followerCount : null,
    }];
  });
}

async function loadNeynarProfiles(apiKey: string | undefined, fids: number[]): Promise<StoredProfile[]> {
  const key = apiKey?.trim();
  const requestedFids = [...new Set(fids)].slice(0, 100);
  if (!key || requestedFids.length === 0) return [];
  const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${encodeURIComponent(requestedFids.join(","))}`;
  const response = await outboundFetch(endpoint, {
    headers: { accept: "application/json", "x-api-key": key },
  });
  if (!response.ok) throw new Error(`Neynar social-proof reconciliation failed (${response.status})`);
  const payload = await response.json<{ users?: unknown[] }>();
  return cleanProfileRows(payload.users);
}

export async function readEmailSocialProof(
  db: D1Database,
  viewerFid: number,
  limit = 15,
): Promise<EmailSocialProofResult> {
  const safeLimit = Math.max(1, Math.min(30, Math.floor(limit)));
  const [countRow, profileRows] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS subscriber_count FROM email_social_proof_members")
      .first<{ subscriber_count: number }>(),
    db.prepare(
      `SELECT p.fid, p.username, p.pfp_url, p.follower_count
       FROM email_social_proof_profiles p
       LEFT JOIN warplets_user_best_friends bf
         ON bf.user_fid = ? AND bf.best_friend_fid = p.fid
       WHERE EXISTS (
         SELECT 1 FROM email_social_proof_members m WHERE m.farcaster_fid = p.fid
       )
       ORDER BY
         CASE WHEN bf.best_friend_fid IS NOT NULL THEN 0 ELSE 1 END,
         COALESCE(bf.mutual_affinity_score, -1) DESC,
         COALESCE(p.follower_count, 0) DESC,
         p.fid ASC
       LIMIT ?`,
    ).bind(viewerFid > 0 ? viewerFid : -1, safeLimit).all<StoredProfile>(),
  ]);

  return {
    subscriberCount: Math.max(0, Number(countRow?.subscriber_count ?? 0)),
    profiles: (profileRows.results ?? []).map((row) => ({
      fid: Number(row.fid),
      username: row.username?.trim() || null,
      pfpUrl: row.pfp_url,
    })),
  };
}

export async function recordEmailSocialProofMember(
  db: D1Database,
  email: string,
  farcasterFid?: number | null,
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;
  const fid = Number.isSafeInteger(farcasterFid) && Number(farcasterFid) > 0 ? Number(farcasterFid) : null;
  const now = new Date().toISOString();
  const statements = [
    db.prepare(
      `INSERT INTO email_social_proof_members (email, farcaster_fid, reconciled_at, updated_at)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(email) DO UPDATE SET
         farcaster_fid = COALESCE(excluded.farcaster_fid, email_social_proof_members.farcaster_fid),
         reconciled_at = NULL,
         updated_at = excluded.updated_at`,
    ).bind(normalizedEmail, fid, now),
    db.prepare("UPDATE email_social_proof_state SET updated_at = ? WHERE id = 1").bind(now),
  ];
  if (fid) {
    statements.push(db.prepare(
      `INSERT INTO email_social_proof_profiles (fid, username, pfp_url, follower_count, reconciled_at, updated_at)
       SELECT fid, NULLIF(trim(username), ''), trim(pfp_url), follower_count, NULL, ?
       FROM warplets_users
       WHERE fid = ? AND pfp_url IS NOT NULL AND trim(pfp_url) <> ''
       ON CONFLICT(fid) DO UPDATE SET
         username = excluded.username,
         pfp_url = excluded.pfp_url,
         follower_count = excluded.follower_count,
         reconciled_at = NULL,
         updated_at = excluded.updated_at`,
    ).bind(now, fid));
  }
  await db.batch(statements);
}

export async function removeEmailSocialProofMember(db: D1Database, email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM email_social_proof_members WHERE email = ?").bind(normalizedEmail),
    db.prepare(
      `DELETE FROM email_social_proof_profiles
       WHERE NOT EXISTS (
         SELECT 1 FROM email_social_proof_members m
         WHERE m.farcaster_fid = email_social_proof_profiles.fid
       )`,
    ),
    db.prepare("UPDATE email_social_proof_state SET updated_at = ? WHERE id = 1").bind(now),
  ]);
}

export async function reconcileEmailSocialProof(env: EmailSocialProofEnv): Promise<EmailSocialProofResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured for social-proof reconciliation");
  const members = await listResendSubscriberMembers(apiKey);
  const fids = [...new Set(members.flatMap((member) => member.farcasterFid ? [member.farcasterFid] : []))];
  const localProfiles = fids.length === 0 ? [] : (await env.WARPLETS.prepare(
    `SELECT fid, NULLIF(trim(username), '') AS username, trim(pfp_url) AS pfp_url, follower_count
     FROM warplets_users
     WHERE fid IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       AND pfp_url IS NOT NULL AND trim(pfp_url) <> ''`,
  ).bind(JSON.stringify(fids)).all<StoredProfile>()).results ?? [];
  const localFids = new Set(localProfiles.map((profile) => Number(profile.fid)));
  const missingFids = fids.filter((fid) => !localFids.has(fid));
  const neynarProfiles = await loadNeynarProfiles(env.NEYNAR_API_KEY, missingFids).catch((error) => {
    console.error("Subscriber profile reconciliation fallback failed", error);
    return [];
  });
  const profiles = [...new Map([...neynarProfiles, ...localProfiles]
    .map((profile) => [Number(profile.fid), profile])).values()];
  const now = new Date();
  const nowIso = now.toISOString();
  const nextReconcileAt = new Date(now.getTime() + RECONCILE_INTERVAL_MS).toISOString();

  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      `INSERT INTO email_social_proof_members (email, farcaster_fid, reconciled_at, updated_at)
       SELECT
         lower(trim(json_extract(value, '$.email'))),
         CASE WHEN json_extract(value, '$.farcasterFid') IS NULL
           THEN NULL ELSE CAST(json_extract(value, '$.farcasterFid') AS INTEGER) END,
         ?,
         ?
       FROM json_each(?)
       WHERE 1
       ON CONFLICT(email) DO UPDATE SET
         farcaster_fid = excluded.farcaster_fid,
         reconciled_at = excluded.reconciled_at,
         updated_at = excluded.updated_at`,
    ).bind(nowIso, nowIso, JSON.stringify(members)),
    env.WARPLETS.prepare(
      "DELETE FROM email_social_proof_members WHERE reconciled_at IS NOT NULL AND reconciled_at <> ?",
    ).bind(nowIso),
    env.WARPLETS.prepare(
      `INSERT INTO email_social_proof_profiles (fid, username, pfp_url, follower_count, reconciled_at, updated_at)
       SELECT
         CAST(json_extract(value, '$.fid') AS INTEGER),
         NULLIF(trim(json_extract(value, '$.username')), ''),
         trim(json_extract(value, '$.pfp_url')),
         CASE WHEN json_extract(value, '$.follower_count') IS NULL
           THEN NULL ELSE CAST(json_extract(value, '$.follower_count') AS INTEGER) END,
         ?,
         ?
       FROM json_each(?)
       WHERE 1
       ON CONFLICT(fid) DO UPDATE SET
         username = excluded.username,
         pfp_url = excluded.pfp_url,
         follower_count = excluded.follower_count,
         reconciled_at = excluded.reconciled_at,
         updated_at = excluded.updated_at`,
    ).bind(nowIso, nowIso, JSON.stringify(profiles)),
    env.WARPLETS.prepare(
      `DELETE FROM email_social_proof_profiles
       WHERE reconciled_at IS NOT NULL AND reconciled_at <> ?`,
    ).bind(nowIso),
    env.WARPLETS.prepare(
      `UPDATE email_social_proof_state
       SET reconciled_at = ?, next_reconcile_at = ?, last_error = NULL, updated_at = ?
       WHERE id = 1`,
    ).bind(nowIso, nextReconcileAt, nowIso),
  ]);

  return readEmailSocialProof(env.WARPLETS, -1);
}

export async function reconcileEmailSocialProofIfDue(env: EmailSocialProofEnv): Promise<boolean> {
  const state = await env.WARPLETS.prepare(
    "SELECT next_reconcile_at FROM email_social_proof_state WHERE id = 1",
  ).first<{ next_reconcile_at: string }>();
  if (state?.next_reconcile_at && Date.parse(state.next_reconcile_at) > Date.now()) return false;

  const now = new Date();
  const retryAt = new Date(now.getTime() + RECONCILE_RETRY_MS).toISOString();
  await env.WARPLETS.prepare(
    "UPDATE email_social_proof_state SET next_reconcile_at = ?, updated_at = ? WHERE id = 1",
  ).bind(retryAt, now.toISOString()).run();
  try {
    await reconcileEmailSocialProof(env);
    return true;
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await env.WARPLETS.prepare(
      "UPDATE email_social_proof_state SET last_error = ?, updated_at = ? WHERE id = 1",
    ).bind(detail, new Date().toISOString()).run().catch(() => undefined);
    throw error;
  }
}
