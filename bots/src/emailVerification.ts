import { validateEmailAddress } from "./emailValidation";
import {
  confirmProvenEmailIdentity,
  getIdentityProfile,
} from "../../app/functions/_lib/emailIdentityClaims.js";
import { getResendContact } from "../../app/functions/_lib/resendIdentity.js";

export const EMAIL_VERIFICATION_GUILD_ID = "1539539851311845416";
export const EMAIL_VERIFICATION_CHANNEL_ID = "1539543771878789140";
export const EMAIL_VERIFICATION_LOG_CHANNEL_ID = "1539847164585451550";
export const RESEND_DISCORD_SEGMENT_ID = "be2dd809-e0bd-4b71-95ac-eb11f68270c4";

const VERIFIED_ROLE_NAME = "Verified";
const CODE_TTL_MS = 10 * 60 * 1_000;
const SEND_COOLDOWN_MS = 60 * 1_000;
const SEND_WINDOW_MS = 60 * 60 * 1_000;
const MAX_SENDS_PER_WINDOW = 5;
const MAX_CODE_ATTEMPTS = 5;

const SETUP_COMMAND = "setup-email-verification";
const START_BUTTON = "email_verify:start";
const CODE_BUTTON = "email_verify:code";
const EMAIL_MODAL = "email_verify:email_modal";
const CODE_MODAL = "email_verify:code_modal";
const EMAIL_INPUT = "email_verify:email";
const CODE_INPUT = "email_verify:otp";

export interface EmailVerificationEnv {
  EMAIL_VERIFICATIONS?: DurableObjectNamespace;
  EMAIL_VERIFICATION_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_VERIFIED_ROLE_ID?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  WARPLETS?: D1Database;
}

interface DiscordUser {
  id?: string;
  username?: string;
  global_name?: string;
}

interface DiscordComponentValue {
  custom_id?: string;
  value?: string;
  component?: DiscordComponentValue;
  components?: DiscordComponentValue[];
}

export interface EmailVerificationInteraction {
  id?: string;
  type?: number;
  token?: string;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: DiscordUser; permissions?: string; roles?: string[] };
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
    components?: DiscordComponentValue[];
  };
}

interface PendingVerification {
  email: string;
  emailKey: string;
  challengeId: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  codeValidatedAt?: number;
}

interface UserVerificationState {
  pending?: PendingVerification;
  verified?: { email: string; verifiedAt: number };
  sends: number[];
}

interface EmailClaimState {
  guildId?: string;
  verifiedUserId?: string;
  pendingUserId?: string;
  pendingChallengeId?: string;
  pendingExpiresAt?: number;
  sends: number[];
}

type StoreResult = Record<string, unknown> & { ok: boolean; status: string };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function userStorageKey(guildId: string, userId: string): string {
  return `user:${guildId}:${userId}`;
}

function emailStorageKey(emailKey: string): string {
  return `email:${emailKey}`;
}

export class EmailVerificationState {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ ok: false, status: "method_not_allowed" }, 405);
    const path = new URL(request.url).pathname;
    const body: Record<string, unknown> = await request.json<Record<string, unknown>>().catch(() => ({}));
    if (path === "/verified-records") {
      const rows = await this.state.storage.list<UserVerificationState>({ prefix: `user:${EMAIL_VERIFICATION_GUILD_ID}:` });
      const records = [...rows.entries()].flatMap(([key, value]) => {
        const userId = key.slice(`user:${EMAIL_VERIFICATION_GUILD_ID}:`.length);
        return value.verified?.email && userId
          ? [{ userId, email: value.verified.email, verifiedAt: value.verified.verifiedAt }]
          : [];
      });
      return json({ ok: true, status: "listed", records });
    }
    const guildId = stringValue(body.guildId);
    const userId = stringValue(body.userId);
    if (!guildId || !userId) return json({ ok: false, status: "invalid_request" }, 400);

    if (path === "/status") {
      const user = await this.state.storage.get<UserVerificationState>(userStorageKey(guildId, userId));
      return json({
        ok: true,
        status: user?.verified ? "verified" : user?.pending ? "pending" : "empty",
        verifiedEmail: user?.verified?.email ?? null,
        pending: user?.pending ?? null,
      });
    }

    if (path === "/reserve") return this.reserve(body, guildId, userId);
    if (path === "/cancel") return this.cancel(body, guildId, userId);
    if (path === "/check") return this.check(body, guildId, userId);
    if (path === "/complete") return this.complete(body, guildId, userId);
    return json({ ok: false, status: "not_found" }, 404);
  }

  private async reserve(body: Record<string, unknown>, guildId: string, userId: string): Promise<Response> {
    const email = stringValue(body.email);
    const emailKey = stringValue(body.emailKey);
    const challengeId = stringValue(body.challengeId);
    const codeHash = stringValue(body.codeHash);
    const now = numberValue(body.now);
    const expiresAt = numberValue(body.expiresAt);
    if (!email || !emailKey || !challengeId || !codeHash || !now || expiresAt <= now) {
      return json({ ok: false, status: "invalid_request" }, 400);
    }

    const result = await this.state.storage.transaction(async (transaction) => {
      const userKey = userStorageKey(guildId, userId);
      const claimKey = emailStorageKey(emailKey);
      const user = (await transaction.get<UserVerificationState>(userKey)) ?? { sends: [] };
      const claim = (await transaction.get<EmailClaimState>(claimKey)) ?? { sends: [] };
      if (user.verified) return { ok: true, status: "already_verified", email: user.verified.email };
      if (claim.pendingUserId && claim.pendingExpiresAt && claim.pendingExpiresAt > now && (claim.pendingUserId !== userId || claim.guildId !== guildId)) {
        return { ok: false, status: "email_in_progress" };
      }

      user.sends = user.sends.filter((sentAt) => sentAt > now - SEND_WINDOW_MS);
      claim.sends = claim.sends.filter((sentAt) => sentAt > now - SEND_WINDOW_MS);
      const latest = Math.max(user.sends.at(-1) ?? 0, claim.sends.at(-1) ?? 0);
      if (latest && now - latest < SEND_COOLDOWN_MS) {
        return { ok: false, status: "cooldown", retryAfter: Math.ceil((SEND_COOLDOWN_MS - (now - latest)) / 1_000) };
      }
      if (user.sends.length >= MAX_SENDS_PER_WINDOW || claim.sends.length >= MAX_SENDS_PER_WINDOW) {
        return { ok: false, status: "rate_limited" };
      }

      user.sends.push(now);
      user.pending = { email, emailKey, challengeId, codeHash, expiresAt, attempts: 0 };
      claim.guildId = guildId;
      claim.pendingUserId = userId;
      claim.pendingChallengeId = challengeId;
      claim.pendingExpiresAt = expiresAt;
      claim.sends.push(now);
      await transaction.put(userKey, user);
      await transaction.put(claimKey, claim);
      return { ok: true, status: "reserved" };
    });
    return json(result);
  }

  private async cancel(body: Record<string, unknown>, guildId: string, userId: string): Promise<Response> {
    const challengeId = stringValue(body.challengeId);
    await this.state.storage.transaction(async (transaction) => {
      const userKey = userStorageKey(guildId, userId);
      const user = await transaction.get<UserVerificationState>(userKey);
      if (!user?.pending || user.pending.challengeId !== challengeId) return;
      const claimKey = emailStorageKey(user.pending.emailKey);
      const claim = await transaction.get<EmailClaimState>(claimKey);
      if (claim?.pendingChallengeId === challengeId) {
        delete claim.pendingUserId;
        delete claim.pendingChallengeId;
        delete claim.pendingExpiresAt;
        await transaction.put(claimKey, claim);
      }
      delete user.pending;
      await transaction.put(userKey, user);
    });
    return json({ ok: true, status: "cancelled" });
  }

  private async check(body: Record<string, unknown>, guildId: string, userId: string): Promise<Response> {
    const candidateHash = stringValue(body.candidateHash);
    const challengeId = stringValue(body.challengeId);
    const now = numberValue(body.now);
    const result = await this.state.storage.transaction(async (transaction) => {
      const userKey = userStorageKey(guildId, userId);
      const user = await transaction.get<UserVerificationState>(userKey);
      if (user?.verified) return { ok: true, status: "already_verified", email: user.verified.email };
      if (!user?.pending || user.pending.challengeId !== challengeId) return { ok: false, status: "no_challenge" };
      if (user.pending.expiresAt <= now) {
        const claimKey = emailStorageKey(user.pending.emailKey);
        const claim = await transaction.get<EmailClaimState>(claimKey);
        if (claim?.pendingChallengeId === challengeId) {
          delete claim.pendingUserId;
          delete claim.pendingChallengeId;
          delete claim.pendingExpiresAt;
          await transaction.put(claimKey, claim);
        }
        delete user.pending;
        await transaction.put(userKey, user);
        return { ok: false, status: "expired" };
      }
      if (user.pending.codeValidatedAt) return { ok: true, status: "accepted", email: user.pending.email, challengeId };
      if (!constantTimeStringEqual(candidateHash, user.pending.codeHash)) {
        user.pending.attempts += 1;
        const attemptsRemaining = Math.max(0, MAX_CODE_ATTEMPTS - user.pending.attempts);
        if (attemptsRemaining === 0) {
          const claimKey = emailStorageKey(user.pending.emailKey);
          const claim = await transaction.get<EmailClaimState>(claimKey);
          if (claim?.pendingChallengeId === challengeId) {
            delete claim.pendingUserId;
            delete claim.pendingChallengeId;
            delete claim.pendingExpiresAt;
            await transaction.put(claimKey, claim);
          }
          delete user.pending;
        }
        await transaction.put(userKey, user);
        return { ok: false, status: attemptsRemaining ? "invalid_code" : "attempts_exhausted", attemptsRemaining };
      }
      user.pending.codeValidatedAt = now;
      await transaction.put(userKey, user);
      return { ok: true, status: "accepted", email: user.pending.email, challengeId };
    });
    return json(result);
  }

  private async complete(body: Record<string, unknown>, guildId: string, userId: string): Promise<Response> {
    const challengeId = stringValue(body.challengeId);
    const now = numberValue(body.now);
    const result = await this.state.storage.transaction(async (transaction) => {
      const userKey = userStorageKey(guildId, userId);
      const user = await transaction.get<UserVerificationState>(userKey);
      if (user?.verified) return { ok: true, status: "already_verified", email: user.verified.email };
      if (!user?.pending || user.pending.challengeId !== challengeId || !user.pending.codeValidatedAt) {
        return { ok: false, status: "not_validated" };
      }
      const claimKey = emailStorageKey(user.pending.emailKey);
      const claim = (await transaction.get<EmailClaimState>(claimKey)) ?? { sends: [] };
      const email = user.pending.email;
      const replacedUserId = claim.verifiedUserId && claim.verifiedUserId !== userId
        ? claim.verifiedUserId
        : null;
      if (replacedUserId) {
        const replacedKey = userStorageKey(guildId, replacedUserId);
        const replacedUser = await transaction.get<UserVerificationState>(replacedKey);
        if (replacedUser?.verified?.email === email) {
          delete replacedUser.verified;
          await transaction.put(replacedKey, replacedUser);
        }
      }
      claim.guildId = guildId;
      claim.verifiedUserId = userId;
      delete claim.pendingUserId;
      delete claim.pendingChallengeId;
      delete claim.pendingExpiresAt;
      user.verified = { email, verifiedAt: now };
      delete user.pending;
      await transaction.put(claimKey, claim);
      await transaction.put(userKey, user);
      return { ok: true, status: "completed", email, replacedUserId };
    });
    return json(result);
  }
}

function constantTimeStringEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

function verificationStub(env: EmailVerificationEnv): DurableObjectStub {
  const namespace = env.EMAIL_VERIFICATIONS;
  if (!namespace) throw new Error("EMAIL_VERIFICATIONS Durable Object is not configured");
  return namespace.get(namespace.idFromName("discord-email-verification"));
}

async function storeRequest(env: EmailVerificationEnv, path: string, body: Record<string, unknown>): Promise<StoreResult> {
  const response = await verificationStub(env).fetch(`https://email-verification.internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json<StoreResult>();
  if (!response.ok) throw new Error(`Verification state failed (${response.status})`);
  return payload;
}

function randomCode(): string {
  const maximum = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values); while (values[0] >= maximum);
  return String(values[0] % 1_000_000).padStart(6, "0");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function codeHash(env: EmailVerificationEnv, guildId: string, userId: string, email: string, challengeId: string, code: string): Promise<string> {
  const secret = requiredValue(env.EMAIL_VERIFICATION_SECRET, "EMAIL_VERIFICATION_SECRET");
  if (secret.length < 32) throw new Error("EMAIL_VERIFICATION_SECRET must be at least 32 characters");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${guildId}:${userId}:${email}:${challengeId}:${code}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function userFromInteraction(interaction: EmailVerificationInteraction): DiscordUser | null {
  return interaction.member?.user ?? interaction.user ?? null;
}

function displayName(user: DiscordUser): string {
  return (user.global_name || user.username || `Discord ${user.id}`).slice(0, 100);
}

function findInputValue(components: DiscordComponentValue[] | undefined, customId: string): string {
  for (const component of components ?? []) {
    if (component.custom_id === customId && typeof component.value === "string") return component.value;
    const nested = component.component ? [component.component] : component.components;
    const value = findInputValue(nested, customId);
    if (value) return value;
  }
  return "";
}

function modal(customId: string, title: string, inputCustomId: string, label: string, placeholder: string, minLength: number, maxLength: number): Record<string, unknown> {
  return {
    type: 9,
    data: {
      custom_id: customId,
      title,
      components: [{
        type: 18,
        label,
        component: { type: 4, custom_id: inputCustomId, style: 1, placeholder, min_length: minLength, max_length: maxLength, required: true },
      }],
    },
  };
}

function actionRow(buttons: Array<{ customId: string; label: string; style: number; emoji: string }>): Record<string, unknown> {
  return {
    type: 1,
    components: buttons.map((button) => ({
      type: 2,
      custom_id: button.customId,
      label: button.label,
      style: button.style,
      emoji: { name: button.emoji },
    })),
  };
}

const emailButton = () => actionRow([{ customId: START_BUTTON, label: "Enter email", style: 1, emoji: "📧" }]);
const codeButton = () => actionRow([{ customId: CODE_BUTTON, label: "Enter code", style: 3, emoji: "📝" }]);

export function verificationPanelPayload(): Record<string, unknown> {
  return {
    embeds: [{
      title: "Email Verification",
      description: [
        "Verify with a valid email address to unlock the **Verified** role.",
        "",
        "Disposable email providers and domains that cannot receive email are blocked. Your verification code expires after 10 minutes.",
        "",
        "By continuing, you agree that 10X may store your email and use it for sending you community updates. You can unsubscribe at any time.",
      ].join("\n"),
      color: 0x00ff00,
      footer: { text: "Your email and code are entered privately in Discord." },
    }],
    components: [actionRow([
      { customId: START_BUTTON, label: "Enter email", style: 1, emoji: "📧" },
      { customId: CODE_BUTTON, label: "Enter code", style: 3, emoji: "📝" },
    ])],
    allowed_mentions: { parse: [] },
  };
}

async function discordRequest(env: EmailVerificationEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const token = requiredValue(env.DISCORD_BOT_TOKEN, "DISCORD_BOT_TOKEN");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bot ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`https://discord.com/api/v10${path}`, { ...init, headers });
}

async function discordRequestOk(env: EmailVerificationEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await discordRequest(env, path, init);
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Discord API failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return response;
}

export async function backfillExistingDiscordVerifications(env: EmailVerificationEnv): Promise<number> {
  const db = env.WARPLETS;
  if (!db || !env.EMAIL_VERIFICATIONS) return 0;
  const response = await verificationStub(env).fetch("https://email-verification.internal/verified-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`Verification record listing failed (${response.status})`);
  const payload = await response.json<{
    records?: Array<{ userId?: string; email?: string; verifiedAt?: number }>;
  }>();
  let changed = 0;
  for (const record of payload.records ?? []) {
    const userId = record.userId?.trim() ?? "";
    const email = record.email?.trim().toLowerCase() ?? "";
    if (!userId || !email) continue;
    const existing = await getIdentityProfile(db, email);
    if (existing?.discordUserId === userId && existing.discordName) continue;
    const memberResponse = await discordRequestOk(
      env,
      `/guilds/${EMAIL_VERIFICATION_GUILD_ID}/members/${userId}`,
    );
    const member = await memberResponse.json<{ user?: DiscordUser }>();
    const user = member.user;
    if (!user?.id) throw new Error(`Discord member ${userId} is unavailable`);
    await ensureResendContact(
      env,
      email,
      displayName(user),
      userId,
      `discord-do-backfill:${userId}:${Number(record.verifiedAt) || 0}`,
    );
    changed += 1;
  }
  return changed;
}

function containsStartButton(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.custom_id === START_BUTTON) return true;
  return [record.components, record.component].some((nested) => Array.isArray(nested)
    ? nested.some(containsStartButton)
    : containsStartButton(nested));
}

async function postOrUpdateVerificationPanel(env: EmailVerificationEnv): Promise<void> {
  let existingId: string | null = null;
  try {
    const response = await discordRequestOk(env, `/channels/${EMAIL_VERIFICATION_CHANNEL_ID}/messages?limit=100`);
    const messages = await response.json<Array<Record<string, unknown>>>();
    const existing = messages.find((message) => (message.author as { bot?: unknown } | undefined)?.bot === true && containsStartButton(message.components));
    existingId = typeof existing?.id === "string" ? existing.id : null;
  } catch {
    // Posting still works when the bot cannot read older channel history.
  }
  const path = existingId
    ? `/channels/${EMAIL_VERIFICATION_CHANNEL_ID}/messages/${existingId}`
    : `/channels/${EMAIL_VERIFICATION_CHANNEL_ID}/messages`;
  await discordRequestOk(env, path, { method: existingId ? "PATCH" : "POST", body: JSON.stringify(verificationPanelPayload()) });
}

async function editOriginalReply(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, payload: Record<string, unknown>): Promise<void> {
  const appId = interaction.application_id || env.DISCORD_APPLICATION_ID;
  if (!appId || !interaction.token) throw new Error("Discord interaction reply credentials are unavailable");
  const response = await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  if (!response.ok) throw new Error(`Discord interaction reply failed (${response.status})`);
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "invalid email";
  return `${local.slice(0, 1)}${"*".repeat(Math.min(6, Math.max(3, local.length - 1)))}@${domain}`;
}

async function logVerification(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, success: boolean, detail: string, email?: string): Promise<void> {
  const user = userFromInteraction(interaction);
  const fields = [
    { name: "Discord user", value: user?.id ? `<@${user.id}> (${user.id})` : "Unknown", inline: false },
    ...(email ? [{ name: "Email", value: maskEmail(email), inline: false }] : []),
    { name: "Result", value: detail.slice(0, 1_024), inline: false },
  ];
  await discordRequestOk(env, `/channels/${EMAIL_VERIFICATION_LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({
      embeds: [{ title: success ? "Email verification succeeded" : "Email verification failed", color: success ? 0x00ff00 : 0xff3333, fields, timestamp: new Date().toISOString() }],
      allowed_mentions: { parse: [] },
    }),
  });
}

async function sendVerificationEmail(env: EmailVerificationEnv, email: string, code: string, challengeId: string): Promise<void> {
  const apiKey = requiredValue(env.RESEND_API_KEY, "RESEND_API_KEY");
  const from = env.RESEND_FROM_EMAIL?.trim() || "10X Meme <10x@10x.meme>";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": `discord-verification-${challengeId}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your 10X Discord verification code",
      text: `Your 10X Discord verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111"><h1 style="font-size:22px">Verify your Discord email</h1><p>Enter this code in the 10X Discord server:</p><div style="font-size:34px;font-weight:800;letter-spacing:8px;padding:18px;background:#f1f5f1;border-radius:10px;text-align:center">${code}</div><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
      tags: [{ name: "source", value: "discord_verification" }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend email failed (${response.status})`);
  }
}

export async function ensureResendContact(
  env: EmailVerificationEnv,
  email: string,
  name: string,
  discordUserId: string,
  proofId = `discord-refresh:${discordUserId}:${name}`,
): Promise<{ existed: boolean; unsubscribed: boolean; synced: boolean }> {
  const apiKey = requiredValue(env.RESEND_API_KEY, "RESEND_API_KEY");
  const db = env.WARPLETS;
  if (!db) throw new Error("WARPLETS D1 binding is not configured");
  const [existingProfile, existingContact] = await Promise.all([
    getIdentityProfile(db, email),
    getResendContact(apiKey, email),
  ]);
  const result = await confirmProvenEmailIdentity({
    env: { ...env, WARPLETS: db },
    email,
    source: "discord",
    segmentId: RESEND_DISCORD_SEGMENT_ID,
    proofId,
    identity: { discordUserId, discordName: name },
    resubscribe: false,
  });
  return {
    existed: Boolean(existingProfile || existingContact),
    unsubscribed: existingContact?.unsubscribed === true,
    synced: result.synced,
  };
}

async function verifiedRoleId(env: EmailVerificationEnv): Promise<string> {
  const configured = env.DISCORD_VERIFIED_ROLE_ID?.trim();
  if (configured) return configured;
  const response = await discordRequestOk(env, `/guilds/${EMAIL_VERIFICATION_GUILD_ID}/roles`);
  const roles = await response.json<Array<{ id?: string; name?: string }>>();
  const role = roles.find((candidate) => candidate.name?.trim().toLowerCase() === VERIFIED_ROLE_NAME.toLowerCase());
  if (!role?.id) throw new Error(`Discord role ${VERIFIED_ROLE_NAME} was not found`);
  return role.id;
}

async function grantVerifiedRole(env: EmailVerificationEnv, userId: string): Promise<void> {
  const roleId = await verifiedRoleId(env);
  await discordRequestOk(env, `/guilds/${EMAIL_VERIFICATION_GUILD_ID}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: { "x-audit-log-reason": "Successful email verification" },
  });
}

async function finalizeVerification(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, email: string, challengeId: string): Promise<{ unsubscribed: boolean }> {
  const user = userFromInteraction(interaction)!;
  const contact = await ensureResendContact(env, email, displayName(user), user.id!, `discord-otp:${challengeId}`);
  const complete = await storeRequest(env, "/complete", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: user.id,
    challengeId,
    now: Date.now(),
  });
  if (!complete.ok && complete.status !== "already_verified") throw new Error(`Verification completion failed: ${complete.status}`);
  await grantVerifiedRole(env, user.id!);
  return { unsubscribed: contact.unsubscribed };
}

async function reconcileVerified(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, email: string): Promise<void> {
  const user = userFromInteraction(interaction)!;
  await ensureResendContact(env, email, displayName(user), user.id!, `discord-refresh:${user.id}:${displayName(user)}`);
  await grantVerifiedRole(env, user.id!);
  await editOriginalReply(env, interaction, { content: "You are already email verified. I have confirmed your **Verified** role.", components: [] });
}

async function processEmailSubmission(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, rawEmail: string): Promise<void> {
  const user = userFromInteraction(interaction)!;
  const validation = await validateEmailAddress(rawEmail);
  if (!validation.ok) {
    const messages = {
      invalid_format: "Enter a valid email address.",
      disposable_domain: "Disposable email providers cannot be used for verification.",
      undeliverable_domain: "That email domain does not appear able to receive email.",
    } as const;
    await Promise.allSettled([
      logVerification(env, interaction, false, validation.reason),
      editOriginalReply(env, interaction, { content: messages[validation.reason], components: [emailButton()] }),
    ]);
    return;
  }

  const challengeId = crypto.randomUUID();
  const code = randomCode();
  const hash = await codeHash(env, EMAIL_VERIFICATION_GUILD_ID, user.id!, validation.email, challengeId, code);
  const reserve = await storeRequest(env, "/reserve", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: user.id,
    email: validation.email,
    emailKey: await sha256(validation.email),
    challengeId,
    codeHash: hash,
    now: Date.now(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  if (reserve.status === "already_verified") {
    await reconcileVerified(env, interaction, stringValue(reserve.email));
    return;
  }
  if (!reserve.ok) {
    const message = reserve.status === "cooldown"
      ? `Please wait ${Number(reserve.retryAfter) || 60} seconds before requesting another code.`
      : reserve.status === "rate_limited"
        ? "Too many verification emails were requested. Try again in an hour."
        : reserve.status === "email_in_progress"
          ? "That email is currently being verified by another Discord account. Try again after its code expires."
          : "Email verification could not be started.";
    await Promise.allSettled([
      logVerification(env, interaction, false, reserve.status, validation.email),
      editOriginalReply(env, interaction, { content: message, components: [emailButton()] }),
    ]);
    return;
  }

  try {
    await sendVerificationEmail(env, validation.email, code, challengeId);
  } catch (error) {
    await storeRequest(env, "/cancel", { guildId: EMAIL_VERIFICATION_GUILD_ID, userId: user.id, challengeId });
    await Promise.allSettled([
      logVerification(env, interaction, false, "verification_email_send_failed", validation.email),
      editOriginalReply(env, interaction, { content: "I could not send the verification email. Please try again later.", components: [emailButton()] }),
    ]);
    console.error("Resend verification email failed", error);
    return;
  }

  await editOriginalReply(env, interaction, {
    content: `Check **${maskEmail(validation.email)}** for a six-digit code. It expires in 10 minutes. Check spam or junk if it does not arrive.`,
    components: [codeButton()],
  });
}

async function processCodeSubmission(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, rawCode: string): Promise<void> {
  const user = userFromInteraction(interaction)!;
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) {
    await Promise.allSettled([
      logVerification(env, interaction, false, "invalid_code_format"),
      editOriginalReply(env, interaction, { content: "Enter the six-digit code from your email.", components: [codeButton()] }),
    ]);
    return;
  }

  const status = await storeRequest(env, "/status", { guildId: EMAIL_VERIFICATION_GUILD_ID, userId: user.id });
  if (status.status === "verified") {
    await reconcileVerified(env, interaction, stringValue(status.verifiedEmail));
    return;
  }
  const pending = status.pending as PendingVerification | null;
  if (!pending?.email || !pending.challengeId) {
    await editOriginalReply(env, interaction, { content: "No active code was found. Enter your email to request a new code.", components: [emailButton()] });
    return;
  }

  const candidateHash = await codeHash(env, EMAIL_VERIFICATION_GUILD_ID, user.id!, pending.email, pending.challengeId, code);
  const checked = await storeRequest(env, "/check", {
    guildId: EMAIL_VERIFICATION_GUILD_ID,
    userId: user.id,
    challengeId: pending.challengeId,
    candidateHash,
    now: Date.now(),
  });
  if (!checked.ok) {
    const message = checked.status === "expired"
      ? "That code expired. Enter your email to request a new one."
      : checked.status === "attempts_exhausted"
        ? "Too many incorrect attempts. Enter your email to request a new code."
        : `That code is incorrect. ${Number(checked.attemptsRemaining) || 0} attempt(s) remain.`;
    await Promise.allSettled([
      logVerification(env, interaction, false, checked.status, pending.email),
      editOriginalReply(env, interaction, { content: message, components: [checked.status === "invalid_code" ? codeButton() : emailButton()] }),
    ]);
    return;
  }

  const result = await finalizeVerification(env, interaction, pending.email, pending.challengeId);
  await Promise.allSettled([
    logVerification(env, interaction, true, result.unsubscribed ? "verified; existing unsubscribe preference preserved" : "verified and added to Discord segment", pending.email),
    editOriginalReply(env, interaction, {
      content: "Email verified! The **Verified** role was added, you can now post in PUBLIC channels 🎉",
      components: [],
    }),
  ]);
}

function canManageGuild(interaction: EmailVerificationInteraction): boolean {
  try {
    const permissions = BigInt(interaction.member?.permissions ?? "0");
    return (permissions & 8n) !== 0n || (permissions & 32n) !== 0n;
  } catch {
    return false;
  }
}

async function processSetup(env: EmailVerificationEnv, interaction: EmailVerificationInteraction): Promise<void> {
  await postOrUpdateVerificationPanel(env);
  await editOriginalReply(env, interaction, { content: `<#${EMAIL_VERIFICATION_CHANNEL_ID}> now contains the email verification panel.`, components: [] });
}

async function runDeferredTask(env: EmailVerificationEnv, interaction: EmailVerificationInteraction, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error("Discord email verification failed", error);
    await Promise.allSettled([
      logVerification(env, interaction, false, "internal_error"),
      editOriginalReply(env, interaction, { content: "Email verification hit a temporary error. Please try again later.", components: [] }),
    ]);
  }
}

export function handleEmailVerificationInteraction(
  env: EmailVerificationEnv,
  interaction: EmailVerificationInteraction,
  waitUntil: (promise: Promise<unknown>) => void,
): Record<string, unknown> | null {
  const command = interaction.type === 2 && interaction.data?.name === SETUP_COMMAND;
  const component = interaction.type === 3 && [START_BUTTON, CODE_BUTTON].includes(interaction.data?.custom_id ?? "");
  const modalSubmit = interaction.type === 5 && [EMAIL_MODAL, CODE_MODAL].includes(interaction.data?.custom_id ?? "");
  if (!command && !component && !modalSubmit) return null;

  const user = userFromInteraction(interaction);
  if (!user?.id || interaction.guild_id !== EMAIL_VERIFICATION_GUILD_ID) {
    return { type: 4, data: { content: "Email verification is only available in the configured 10X Discord server.", flags: 64 } };
  }

  if (command) {
    if (!canManageGuild(interaction)) return { type: 4, data: { content: "Manage Server permission is required.", flags: 64 } };
    waitUntil(runDeferredTask(env, interaction, () => processSetup(env, interaction)));
    return { type: 5, data: { flags: 64 } };
  }
  if (component) {
    return interaction.data?.custom_id === START_BUTTON
      ? modal(EMAIL_MODAL, "Verify your email", EMAIL_INPUT, "Email address", "you@example.com", 5, 254)
      : modal(CODE_MODAL, "Enter verification code", CODE_INPUT, "Six-digit code", "123456", 6, 6);
  }

  const customId = interaction.data?.custom_id;
  const value = findInputValue(interaction.data?.components, customId === EMAIL_MODAL ? EMAIL_INPUT : CODE_INPUT);
  waitUntil(runDeferredTask(env, interaction, () => customId === EMAIL_MODAL
    ? processEmailSubmission(env, interaction, value)
    : processCodeSubmission(env, interaction, value)));
  return { type: 5, data: { flags: 64 } };
}
