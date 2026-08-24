import { sha256Hex } from "./security.js";
import { syncDropWaitlistActionCompletion } from "./dropEmailReward.js";
import { recordEmailSocialProofMember, removeEmailSocialProofMember } from "./emailSocialProof.js";
import { enqueueEmailOnboarding, type EmailOnboardingEnv } from "./emailOnboarding.js";
import {
  normalizeIdentity,
  refreshTrustedIdentityLabels,
  syncTrustedIdentityToResend,
  type TrustedEmailIdentity,
} from "./resendIdentity.js";

export interface EmailIdentityEnv extends EmailOnboardingEnv {
  WARPLETS: D1Database;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_AUDIENCE_MUTATIONS_ENABLED?: string;
}

export type EmailIdentityClaim = {
  id: string;
  email: string;
  source: string;
  segment_id: string;
  token_hash: string;
  farcaster_fid: number | null;
  farcaster_username: string | null;
  discord_user_id: string | null;
  discord_name: string | null;
  wallet: string | null;
  drop_reward_eligible: number;
  resubscribe: number;
  status: "pending" | "superseded" | "expired" | "confirmed_pending_sync" | "synced";
  expires_at: string;
  created_at: string;
  confirmed_at: string | null;
  synced_at: string | null;
  last_error: string | null;
};

type EmailIdentityProfileRow = {
  email: string;
  farcaster_fid: number | null;
  farcaster_username: string | null;
  discord_user_id: string | null;
  discord_name: string | null;
  wallet: string | null;
  email_verified_at: string;
};

const CLAIM_TTL_MS = 24 * 60 * 60 * 1_000;

export function emailAudienceMutationsEnabled(
  env: Pick<EmailIdentityEnv, "EMAIL_AUDIENCE_MUTATIONS_ENABLED">,
): boolean {
  return env.EMAIL_AUDIENCE_MUTATIONS_ENABLED?.trim().toLowerCase() !== "false";
}

function requireEmailAudienceMutations(env: EmailIdentityEnv): void {
  if (!emailAudienceMutationsEnabled(env)) {
    throw new Error("Email audience mutations are disabled in this environment");
  }
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}

function rowIdentity(row: EmailIdentityProfileRow | null): TrustedEmailIdentity | null {
  if (!row) return null;
  return normalizeIdentity({
    email: row.email,
    farcasterFid: row.farcaster_fid,
    farcasterUsername: row.farcaster_username,
    discordUserId: row.discord_user_id,
    discordName: row.discord_name,
    wallet: row.wallet,
  });
}

function claimIdentity(claim: EmailIdentityClaim): TrustedEmailIdentity {
  return normalizeIdentity({
    email: claim.email,
    farcasterFid: claim.farcaster_fid,
    farcasterUsername: claim.farcaster_username,
    discordUserId: claim.discord_user_id,
    discordName: claim.discord_name,
    wallet: claim.wallet,
  });
}

export async function getIdentityProfile(db: D1Database, email: string): Promise<TrustedEmailIdentity | null> {
  const row = await db.prepare(
    `SELECT email, farcaster_fid, farcaster_username, discord_user_id, discord_name, wallet, email_verified_at
     FROM email_identity_profiles WHERE email = ? LIMIT 1`,
  ).bind(email.trim().toLowerCase()).first<EmailIdentityProfileRow>();
  return rowIdentity(row);
}

async function sendConfirmationEmail(
  env: EmailIdentityEnv,
  email: string,
  confirmationUrl: string,
  claimId: string,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const safeUrl = htmlEscape(confirmationUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `10x-email-claim-${claimId}`,
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL?.trim() || "10X Meme <10x@10x.meme>",
      to: [email],
      subject: "Confirm your 10X subscription",
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111"><h1 style="font-size:24px">Confirm your 10X subscription</h1><p>Someone used this email address to join 10X community updates. Confirm only if that was you.</p><p><a href="${safeUrl}" style="display:inline-block;background:#00ff00;color:#053505;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:800">Review and confirm</a></p><p style="font-size:12px;color:#666;word-break:break-all">${safeUrl}</p><p style="font-size:12px;color:#666">This link expires in 24 hours. If you did not request it, ignore this email and nothing will change.</p></div>`,
      tags: [{ name: "source", value: "10x_double_opt_in" }],
    }),
  });
  if (!response.ok) throw new Error(`Resend confirmation email failed (${response.status})`);
}

async function refreshSameIdentityLabel(
  env: EmailIdentityEnv,
  existing: TrustedEmailIdentity | null,
  requested: TrustedEmailIdentity,
  source: string,
): Promise<void> {
  if (!existing || !requested.farcasterFid || existing.farcasterFid !== requested.farcasterFid) return;
  if (!requested.farcasterUsername || requested.farcasterUsername === existing.farcasterUsername) return;
  const now = new Date().toISOString();
  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      "UPDATE email_identity_profiles SET farcaster_username = ?, updated_at = ? WHERE email = ? AND farcaster_fid = ?",
    ).bind(requested.farcasterUsername, now, requested.email, requested.farcasterFid),
    env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, previous_value, new_value, created_at)
       VALUES (?, NULL, 'label_refreshed', ?, ?, ?, ?)`,
    ).bind(requested.email, source, existing.farcasterUsername, requested.farcasterUsername, now),
  ]);
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) {
    await refreshTrustedIdentityLabels({
      apiKey,
      identity: { ...existing, farcasterUsername: requested.farcasterUsername },
    });
  }
}

export async function createEmailIdentityClaim(input: {
  env: EmailIdentityEnv;
  requestUrl: string;
  email: string;
  source: string;
  segmentId: string;
  identity?: Omit<TrustedEmailIdentity, "email">;
  dropRewardEligible?: boolean;
  resubscribe?: boolean;
}): Promise<void> {
  requireEmailAudienceMutations(input.env);
  const email = input.email.trim().toLowerCase();
  const identity = normalizeIdentity({ email, ...input.identity });
  const existing = await getIdentityProfile(input.env.WARPLETS, email);
  await refreshSameIdentityLabel(input.env, existing, identity, input.source);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const claimId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
  await input.env.WARPLETS.batch([
    input.env.WARPLETS.prepare(
      `UPDATE email_identity_claims SET status = 'superseded', last_error = NULL
       WHERE email = ? AND segment_id = ? AND status = 'pending'`,
    ).bind(email, input.segmentId),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_claims (
         id, email, source, segment_id, token_hash, farcaster_fid, farcaster_username,
         discord_user_id, discord_name, wallet, drop_reward_eligible, resubscribe,
         status, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(
      claimId,
      email,
      input.source,
      input.segmentId,
      tokenHash,
      identity.farcasterFid,
      identity.farcasterUsername,
      identity.discordUserId,
      identity.discordName,
      identity.wallet,
      input.dropRewardEligible ? 1 : 0,
      input.resubscribe === false ? 0 : 1,
      expiresAt,
      nowIso,
    ),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, created_at)
       VALUES (?, ?, 'claim_created', ?, ?)`,
    ).bind(email, claimId, input.source, nowIso),
  ]);

  const confirmationUrl = new URL("/api/email/confirm", input.requestUrl);
  confirmationUrl.searchParams.set("token", token);
  try {
    await sendConfirmationEmail(input.env, email, confirmationUrl.toString(), claimId);
  } catch (error) {
    await input.env.WARPLETS.prepare(
      "UPDATE email_identity_claims SET last_error = ? WHERE id = ?",
    ).bind(errorText(error), claimId).run();
    throw error;
  }
}

export async function findEmailIdentityClaim(
  db: D1Database,
  rawToken: string,
): Promise<EmailIdentityClaim | null> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) return null;
  const tokenHash = await sha256Hex(rawToken.toLowerCase());
  return db.prepare(
    `SELECT id, email, source, segment_id, token_hash, farcaster_fid, farcaster_username,
            discord_user_id, discord_name, wallet, drop_reward_eligible, resubscribe,
            status, expires_at, created_at,
            confirmed_at, synced_at, last_error
     FROM email_identity_claims WHERE token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<EmailIdentityClaim>();
}

function mergedIdentity(existing: TrustedEmailIdentity | null, requested: TrustedEmailIdentity): TrustedEmailIdentity {
  return normalizeIdentity({
    email: requested.email,
    farcasterFid: requested.farcasterFid ?? existing?.farcasterFid,
    farcasterUsername: requested.farcasterFid
      ? requested.farcasterUsername ?? (requested.farcasterFid === existing?.farcasterFid ? existing?.farcasterUsername : null)
      : existing?.farcasterUsername,
    discordUserId: requested.discordUserId ?? existing?.discordUserId,
    discordName: requested.discordUserId
      ? requested.discordName ?? (requested.discordUserId === existing?.discordUserId ? existing?.discordName : null)
      : existing?.discordName,
    wallet: requested.wallet ?? existing?.wallet,
  });
}

async function markClaimSynced(env: EmailIdentityEnv, claim: EmailIdentityClaim): Promise<void> {
  requireEmailAudienceMutations(env);
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const profile = await getIdentityProfile(env.WARPLETS, claim.email);
  if (!profile) throw new Error("Confirmed identity profile is missing");
  const resendResult = await syncTrustedIdentityToResend({
    apiKey,
    identity: profile,
    segmentId: claim.segment_id,
    resubscribe: claim.resubscribe === 1,
  });
  const socialProofUpdate = resendResult.active
    ? recordEmailSocialProofMember(env.WARPLETS, profile.email, profile.farcasterFid)
    : removeEmailSocialProofMember(env.WARPLETS, profile.email);
  await socialProofUpdate.catch((error) => {
    console.error("Email social-proof projection update failed", error);
  });
  const now = new Date().toISOString();
  if (resendResult.active) {
    await enqueueEmailOnboarding({
      env,
      email: claim.email,
      source: claim.source,
      claimId: claim.id,
      resubscribe: claim.resubscribe === 1,
    });
  }
  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      "UPDATE email_identity_claims SET status = 'synced', synced_at = ?, last_error = NULL WHERE id = ?",
    ).bind(now, claim.id),
    env.WARPLETS.prepare("DELETE FROM email_resend_outbox WHERE claim_id = ?").bind(claim.id),
    env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, created_at)
       VALUES (?, ?, 'resend_sync_succeeded', ?, ?)`,
    ).bind(claim.email, claim.id, claim.source, now),
  ]);
}

async function deferClaimSync(env: EmailIdentityEnv, claim: EmailIdentityClaim, error: unknown): Promise<void> {
  const current = await env.WARPLETS.prepare(
    "SELECT attempts FROM email_resend_outbox WHERE claim_id = ? LIMIT 1",
  ).bind(claim.id).first<{ attempts: number }>();
  const attempts = Number(current?.attempts ?? 0) + 1;
  const delaySeconds = Math.min(6 * 60 * 60, 60 * (2 ** Math.min(attempts, 8)));
  const now = new Date();
  const nextAttempt = new Date(now.getTime() + delaySeconds * 1_000).toISOString();
  const detail = errorText(error);
  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      `UPDATE email_resend_outbox
       SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE claim_id = ?`,
    ).bind(attempts, nextAttempt, detail, now.toISOString(), claim.id),
    env.WARPLETS.prepare(
      "UPDATE email_identity_claims SET last_error = ? WHERE id = ?",
    ).bind(detail, claim.id),
    env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, new_value, created_at)
       VALUES (?, ?, 'resend_sync_deferred', ?, ?, ?)`,
    ).bind(claim.email, claim.id, claim.source, detail, now.toISOString()),
  ]);
}

export async function confirmEmailIdentityClaim(input: {
  env: EmailIdentityEnv;
  token: string;
}): Promise<{ status: "confirmed" | "already_confirmed" | "expired" | "invalid"; synced: boolean }> {
  const claim = await findEmailIdentityClaim(input.env.WARPLETS, input.token);
  if (!claim) return { status: "invalid", synced: false };
  if (claim.status === "synced") return { status: "already_confirmed", synced: true };
  if (claim.status === "confirmed_pending_sync") {
    try {
      await markClaimSynced(input.env, claim);
      return { status: "already_confirmed", synced: true };
    } catch (error) {
      await deferClaimSync(input.env, claim, error);
      return { status: "already_confirmed", synced: false };
    }
  }
  if (claim.status !== "pending") return { status: "invalid", synced: false };
  const now = new Date();
  const nowIso = now.toISOString();
  if (Date.parse(claim.expires_at) <= now.getTime()) {
    await input.env.WARPLETS.prepare(
      "UPDATE email_identity_claims SET status = 'expired' WHERE id = ? AND status = 'pending'",
    ).bind(claim.id).run();
    return { status: "expired", synced: false };
  }

  const claimed = await input.env.WARPLETS.prepare(
    `UPDATE email_identity_claims SET status = 'confirmed_pending_sync', confirmed_at = ?
     WHERE id = ? AND status = 'pending' AND expires_at > ?`,
  ).bind(nowIso, claim.id, nowIso).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) return { status: "invalid", synced: false };

  const existing = await getIdentityProfile(input.env.WARPLETS, claim.email);
  const requested = claimIdentity(claim);
  const merged = mergedIdentity(existing, requested);
  const replacementEvents: D1PreparedStatement[] = [];
  if (existing?.farcasterFid && requested.farcasterFid && existing.farcasterFid !== requested.farcasterFid) {
    replacementEvents.push(input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, previous_value, new_value, created_at)
       VALUES (?, ?, 'identity_replaced', ?, ?, ?, ?)`,
    ).bind(claim.email, claim.id, claim.source, `farcaster:${existing.farcasterFid}`, `farcaster:${requested.farcasterFid}`, nowIso));
  }
  if (existing?.discordUserId && requested.discordUserId && existing.discordUserId !== requested.discordUserId) {
    replacementEvents.push(input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, previous_value, new_value, created_at)
       VALUES (?, ?, 'identity_replaced', ?, ?, ?, ?)`,
    ).bind(claim.email, claim.id, claim.source, `discord:${existing.discordUserId}`, `discord:${requested.discordUserId}`, nowIso));
  }

  await input.env.WARPLETS.batch([
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_profiles (
         email, farcaster_fid, farcaster_username, discord_user_id, discord_name, wallet,
         email_verified_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         farcaster_fid = excluded.farcaster_fid,
         farcaster_username = excluded.farcaster_username,
         discord_user_id = excluded.discord_user_id,
         discord_name = excluded.discord_name,
         wallet = excluded.wallet,
         email_verified_at = excluded.email_verified_at,
         updated_at = excluded.updated_at`,
    ).bind(
      merged.email,
      merged.farcasterFid,
      merged.farcasterUsername,
      merged.discordUserId,
      merged.discordName,
      merged.wallet,
      nowIso,
      nowIso,
      nowIso,
    ),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_memberships (email, segment_id, source, confirmed_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email, segment_id) DO UPDATE SET source = excluded.source,
         confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at`,
    ).bind(claim.email, claim.segment_id, claim.source, nowIso, nowIso),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_resend_outbox (claim_id, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, 0, ?, ?, ?)
       ON CONFLICT(claim_id) DO UPDATE SET next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at`,
    ).bind(claim.id, nowIso, nowIso, nowIso),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, created_at)
       VALUES (?, ?, 'email_confirmed', ?, ?)`,
    ).bind(claim.email, claim.id, claim.source, nowIso),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_waitlist (
         email, fid, username, token_id, matched, verified, verify_token, subscribed_at,
         verified_at, unsubscribed_at, updated_at, drop_reward_eligible
       ) VALUES (?, ?, ?, NULL, 0, 1, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         fid = CASE WHEN excluded.fid IS NOT NULL THEN excluded.fid ELSE email_waitlist.fid END,
         username = CASE WHEN excluded.username IS NOT NULL THEN excluded.username ELSE email_waitlist.username END,
         verified = 1,
         verified_at = excluded.verified_at,
         unsubscribed_at = CASE WHEN ? = 1 THEN NULL ELSE email_waitlist.unsubscribed_at END,
         updated_at = excluded.updated_at,
         drop_reward_eligible = MAX(email_waitlist.drop_reward_eligible, excluded.drop_reward_eligible)`,
    ).bind(
      claim.email,
      merged.farcasterFid,
      merged.farcasterUsername,
      claim.token_hash,
      nowIso,
      nowIso,
      nowIso,
      claim.drop_reward_eligible,
      claim.resubscribe,
    ),
    ...replacementEvents,
  ]);

  if (claim.drop_reward_eligible === 1 && merged.farcasterFid) {
    await syncDropWaitlistActionCompletion(input.env.WARPLETS, merged.farcasterFid, claim.email);
  }

  try {
    await markClaimSynced(input.env, { ...claim, status: "confirmed_pending_sync", confirmed_at: nowIso });
    return { status: "confirmed", synced: true };
  } catch (error) {
    await deferClaimSync(input.env, claim, error);
    return { status: "confirmed", synced: false };
  }
}

export async function confirmProvenEmailIdentity(input: {
  env: EmailIdentityEnv;
  email: string;
  source: string;
  segmentId: string;
  proofId: string;
  identity: Omit<TrustedEmailIdentity, "email">;
  resubscribe?: boolean;
}): Promise<{ status: "confirmed" | "already_confirmed" | "expired" | "invalid"; synced: boolean }> {
  const email = input.email.trim().toLowerCase();
  const identity = normalizeIdentity({ email, ...input.identity });
  const rawToken = await sha256Hex(`trusted-email-proof:v1:${input.source}:${input.proofId}:${email}`);
  const tokenHash = await sha256Hex(rawToken);
  const claimId = await sha256Hex(`trusted-email-claim:v1:${input.source}:${input.proofId}:${email}`);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();
  await input.env.WARPLETS.batch([
    input.env.WARPLETS.prepare(
      `UPDATE email_identity_claims SET status = 'superseded', last_error = NULL
       WHERE email = ? AND segment_id = ? AND status = 'pending' AND id <> ?`,
    ).bind(email, input.segmentId, claimId),
    input.env.WARPLETS.prepare(
      `INSERT OR IGNORE INTO email_identity_claims (
         id, email, source, segment_id, token_hash, farcaster_fid, farcaster_username,
         discord_user_id, discord_name, wallet, drop_reward_eligible, resubscribe,
         status, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?)`,
    ).bind(
      claimId,
      email,
      input.source,
      input.segmentId,
      tokenHash,
      identity.farcasterFid,
      identity.farcasterUsername,
      identity.discordUserId,
      identity.discordName,
      identity.wallet,
      input.resubscribe === false ? 0 : 1,
      expiresAt,
      nowIso,
    ),
    input.env.WARPLETS.prepare(
      `INSERT INTO email_identity_events (email, claim_id, event_type, source, created_at)
       SELECT ?, ?, 'trusted_proof_recorded', ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM email_identity_events WHERE claim_id = ? AND event_type = 'trusted_proof_recorded'
       )`,
    ).bind(email, claimId, input.source, nowIso, claimId),
  ]);
  return confirmEmailIdentityClaim({ env: input.env, token: rawToken });
}

export async function processEmailIdentityOutbox(env: EmailIdentityEnv, limit = 20): Promise<void> {
  const now = new Date().toISOString();
  const result = await env.WARPLETS.prepare(
    `SELECT c.id, c.email, c.source, c.segment_id, c.token_hash, c.farcaster_fid,
            c.farcaster_username, c.discord_user_id, c.discord_name, c.wallet,
            c.drop_reward_eligible, c.resubscribe, c.status,
            c.expires_at, c.created_at, c.confirmed_at, c.synced_at, c.last_error
     FROM email_resend_outbox o
     JOIN email_identity_claims c ON c.id = o.claim_id
     WHERE o.next_attempt_at <= ? AND c.status = 'confirmed_pending_sync'
     ORDER BY o.next_attempt_at ASC LIMIT ?`,
  ).bind(now, Math.max(1, Math.min(100, limit))).all<EmailIdentityClaim>();
  for (const claim of result.results ?? []) {
    try {
      await markClaimSynced(env, claim);
    } catch (error) {
      await deferClaimSync(env, claim, error);
    }
  }
}
