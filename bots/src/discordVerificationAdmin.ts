import { WorkerEntrypoint } from "cloudflare:workers";
import {
  EMAIL_VERIFICATION_GUILD_ID,
  RESEND_DISCORD_SEGMENT_ID,
  listEmailVerificationRecords,
  removeVerifiedRole,
  resetEmailVerificationState,
  type EmailVerificationEnv,
} from "./emailVerification.js";
import {
  deleteResendContact,
  listResendContactSegments,
  removeDiscordIdentityFromResend,
  type TrustedEmailIdentity,
} from "../../app/functions/_lib/resendIdentity.js";
import { removeEmailSocialProofMember } from "../../app/functions/_lib/emailSocialProof.js";

const DISCORD_USER_ID = /^\d{15,22}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface IdentityRow {
  email: string;
  farcaster_fid: number | null;
  farcaster_username: string | null;
  discord_user_id: string | null;
  discord_name: string | null;
  wallet: string | null;
  email_verified_at: string;
  membership_ids: string | null;
}
export interface DiscordVerificationAdminRow {
  email: string;
  discordUserId: string;
  discordName: string | null;
  verifiedAt: string | null;
  durableObjectVerified: boolean;
  farcasterFid: number | null;
  farcasterUsername: string | null;
  wallet: string | null;
  otherMemberships: string[];
  likelyDeletesContact: boolean;
}

export interface DiscordVerificationResetResult {
  ok: true;
  email: string;
  discordUserId: string;
  durableObjectStatus: string;
  roleRemoved: boolean;
  resendAction: "contact_deleted" | "discord_identity_removed";
  localAction: "email_deleted" | "discord_identity_removed";
  preservedSegmentIds: string[];
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

function memberships(value: string | null): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

function trustedIdentity(row: IdentityRow | null, email: string): TrustedEmailIdentity {
  return {
    email,
    farcasterFid: row?.farcaster_fid ?? null,
    farcasterUsername: row?.farcaster_username ?? null,
    discordUserId: row?.discord_user_id ?? null,
    discordName: row?.discord_name ?? null,
    wallet: row?.wallet ?? null,
  };
}

async function identityRows(db: D1Database): Promise<IdentityRow[]> {
  const result = await db.prepare(
    `SELECT p.email, p.farcaster_fid, p.farcaster_username, p.discord_user_id,
            p.discord_name, p.wallet, p.email_verified_at,
            GROUP_CONCAT(m.segment_id) AS membership_ids
     FROM email_identity_profiles p
     LEFT JOIN email_identity_memberships m ON m.email = p.email
     WHERE p.discord_user_id IS NOT NULL
     GROUP BY p.email, p.farcaster_fid, p.farcaster_username, p.discord_user_id,
              p.discord_name, p.wallet, p.email_verified_at
     ORDER BY p.email_verified_at DESC`,
  ).all<IdentityRow>();
  return result.results ?? [];
}

async function identityRow(db: D1Database, email: string): Promise<IdentityRow | null> {
  return db.prepare(
    `SELECT p.email, p.farcaster_fid, p.farcaster_username, p.discord_user_id,
            p.discord_name, p.wallet, p.email_verified_at,
            GROUP_CONCAT(m.segment_id) AS membership_ids
     FROM email_identity_profiles p
     LEFT JOIN email_identity_memberships m ON m.email = p.email
     WHERE p.email = ?
     GROUP BY p.email, p.farcaster_fid, p.farcaster_username, p.discord_user_id,
              p.discord_name, p.wallet, p.email_verified_at
     LIMIT 1`,
  ).bind(email).first<IdentityRow>();
}

export async function listDiscordVerificationAssociations(
  env: EmailVerificationEnv,
): Promise<DiscordVerificationAdminRow[]> {
  const db = env.WARPLETS;
  if (!db) throw new Error("WARPLETS D1 binding is not configured");
  const [stateRecords, profiles] = await Promise.all([
    listEmailVerificationRecords(env),
    identityRows(db),
  ]);
  const rows = new Map<string, DiscordVerificationAdminRow>();
  for (const profile of profiles) {
    const email = profile.email.trim().toLowerCase();
    const userId = profile.discord_user_id?.trim() ?? "";
    if (!email || !userId) continue;
    const otherMemberships = memberships(profile.membership_ids).filter((id) => id !== RESEND_DISCORD_SEGMENT_ID);
    rows.set(`${userId}:${email}`, {
      email,
      discordUserId: userId,
      discordName: profile.discord_name,
      verifiedAt: profile.email_verified_at,
      durableObjectVerified: false,
      farcasterFid: profile.farcaster_fid,
      farcasterUsername: profile.farcaster_username,
      wallet: profile.wallet,
      otherMemberships,
      likelyDeletesContact: !profile.farcaster_fid && !profile.farcaster_username && !profile.wallet && otherMemberships.length === 0,
    });
  }
  for (const record of stateRecords) {
    const email = record.email.trim().toLowerCase();
    const key = `${record.userId}:${email}`;
    const existing = rows.get(key);
    if (existing) {
      existing.durableObjectVerified = true;
      if (!existing.verifiedAt && record.verifiedAt) existing.verifiedAt = new Date(record.verifiedAt).toISOString();
    } else {
      rows.set(key, {
        email,
        discordUserId: record.userId,
        discordName: null,
        verifiedAt: record.verifiedAt ? new Date(record.verifiedAt).toISOString() : null,
        durableObjectVerified: true,
        farcasterFid: null,
        farcasterUsername: null,
        wallet: null,
        otherMemberships: [],
        likelyDeletesContact: true,
      });
    }
  }
  return [...rows.values()].sort((left, right) => (right.verifiedAt ?? "").localeCompare(left.verifiedAt ?? ""));
}

export async function resetDiscordVerificationAssociation(
  env: EmailVerificationEnv,
  discordUserId: string,
  rawEmail: string,
): Promise<DiscordVerificationResetResult> {
  const userId = discordUserId.trim();
  const email = rawEmail.trim().toLowerCase();
  if (!DISCORD_USER_ID.test(userId) || !EMAIL.test(email) || email.length > 320) {
    throw new Error("Invalid Discord user ID or email address");
  }
  const db = env.WARPLETS;
  if (!db) throw new Error("WARPLETS D1 binding is not configured");
  const [profile, stateRecords] = await Promise.all([
    identityRow(db, email),
    listEmailVerificationRecords(env),
  ]);
  const stateAssociation = stateRecords.some((record) => record.userId === userId && record.email.trim().toLowerCase() === email);
  const databaseAssociation = profile?.discord_user_id === userId;
  if (!stateAssociation && !databaseAssociation) throw new Error("Discord email association was not found or has changed");
  if (profile?.discord_user_id && profile.discord_user_id !== userId) {
    throw new Error("Discord email association changed; refresh the admin list before retrying");
  }

  const apiKey = required(env.RESEND_API_KEY, "RESEND_API_KEY");
  const localMemberships = memberships(profile?.membership_ids ?? null);
  const resendSegments = await listResendContactSegments(apiKey, email);
  const preservedSegmentIds = [...new Set([
    ...localMemberships,
    ...resendSegments.map((segment) => segment.id),
  ])].filter((id) => id !== RESEND_DISCORD_SEGMENT_ID);
  const hasOtherIdentity = Boolean(
    profile?.farcaster_fid || profile?.farcaster_username || profile?.wallet || preservedSegmentIds.length,
  );

  const stateReset = await resetEmailVerificationState(env, userId, email);
  if (!stateReset.ok) throw new Error(`Discord verification state reset failed: ${stateReset.status}`);
  await removeVerifiedRole(env, userId);

  if (hasOtherIdentity) {
    await removeDiscordIdentityFromResend({
      apiKey,
      identity: trustedIdentity(profile, email),
      previousDiscordUserId: userId,
      previousDiscordName: profile?.discord_name,
    });
  } else {
    await deleteResendContact(apiKey, email);
    await removeEmailSocialProofMember(db, email);
  }

  const now = new Date().toISOString();
  if (hasOtherIdentity) {
    await db.batch([
      db.prepare(
        `UPDATE email_identity_profiles
         SET discord_user_id = NULL, discord_name = NULL, updated_at = ?
         WHERE email = ? AND discord_user_id = ?`,
      ).bind(now, email, userId),
      db.prepare(
        "DELETE FROM email_identity_memberships WHERE email = ? AND segment_id = ?",
      ).bind(email, RESEND_DISCORD_SEGMENT_ID),
      db.prepare(
        `DELETE FROM email_resend_outbox WHERE claim_id IN (
           SELECT id FROM email_identity_claims WHERE email = ? AND source = 'discord'
         )`,
      ).bind(email),
      db.prepare(
        `INSERT INTO email_identity_events
           (email, event_type, source, previous_value, new_value, created_at)
         VALUES (?, 'discord_verification_reset', 'admin', ?, NULL, ?)`,
      ).bind(email, `discord:${userId}`, now),
    ]);
  } else {
    const emailHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
    const auditEmail = `sha256:${[...new Uint8Array(emailHash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    await db.batch([
      db.prepare(
        "DELETE FROM email_resend_outbox WHERE claim_id IN (SELECT id FROM email_identity_claims WHERE email = ?)",
      ).bind(email),
      db.prepare("DELETE FROM email_identity_claims WHERE email = ?").bind(email),
      db.prepare("DELETE FROM email_identity_memberships WHERE email = ?").bind(email),
      db.prepare("DELETE FROM email_identity_profiles WHERE email = ?").bind(email),
      db.prepare("DELETE FROM email_waitlist WHERE lower(trim(email)) = ?").bind(email),
      db.prepare("DELETE FROM email_identity_events WHERE email = ?").bind(email),
      db.prepare(
        `INSERT INTO email_identity_events
           (email, event_type, source, previous_value, new_value, created_at)
         VALUES (?, 'discord_verification_reset_deleted', 'admin', ?, NULL, ?)`,
      ).bind(auditEmail, `discord:${userId}`, now),
    ]);
  }

  return {
    ok: true,
    email,
    discordUserId: userId,
    durableObjectStatus: stateReset.status,
    roleRemoved: true,
    resendAction: hasOtherIdentity ? "discord_identity_removed" : "contact_deleted",
    localAction: hasOtherIdentity ? "discord_identity_removed" : "email_deleted",
    preservedSegmentIds,
  };
}

export class DiscordVerificationAdmin extends WorkerEntrypoint<EmailVerificationEnv> {
  listDiscordVerifications(): Promise<DiscordVerificationAdminRow[]> {
    return listDiscordVerificationAssociations(this.env);
  }

  resetDiscordVerification(discordUserId: string, email: string): Promise<DiscordVerificationResetResult> {
    return resetDiscordVerificationAssociation(this.env, discordUserId, email);
  }
}
