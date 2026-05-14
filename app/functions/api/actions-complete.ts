interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  NEYNAR_API_KEY?: string;
  ENABLE_NEYNAR_ACTION_VERIFICATION?: string;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
  SECURITY_LOG_SALT?: string;
}

interface RequestBody {
  actionSlug?: unknown;
  verification?: unknown;
  outreachTokenIds?: unknown;
  outreachRecipients?: unknown;
  sessionToken?: unknown;
  fid?: unknown;
}
import {
  getClientIp,
  jsonSecure,
  logSecurityEvent,
  rateLimit,
  readJsonBodyWithLimit,
  verifyActionSessionToken,
} from "../_lib/security.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function asTokenIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
    .slice(0, 5);
}

type OutreachRecipientInput = {
  tokenId: number;
  fid: number;
  farcasterUsername: string;
  xUsername: string | null;
  mutualAffinityScore: number | null;
  source: "best_friend" | "fallback";
};

function asOptionalMention(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : null;
}

function asOutreachRecipients(value: unknown): OutreachRecipientInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const tokenId = asPositiveInteger(row.tokenId);
      const recipientFid = asPositiveInteger(row.fid);
      const farcasterUsername = asOptionalMention(row.farcasterUsername);
      const xUsername = asOptionalMention(row.xUsername);
      const mutualAffinityScore =
        typeof row.mutualAffinityScore === "number" && Number.isFinite(row.mutualAffinityScore)
          ? row.mutualAffinityScore
          : null;
      const source = row.source === "best_friend" ? "best_friend" : "fallback";
      if (!tokenId || !recipientFid || !farcasterUsername) return null;
      return {
        tokenId,
        fid: recipientFid,
        farcasterUsername,
        xUsername,
        mutualAffinityScore,
        source,
      } satisfies OutreachRecipientInput;
    })
    .filter((item): item is OutreachRecipientInput => item !== null)
    .slice(0, 5);
}

const DROP_UNLOCK_ACTION_SLUGS = [
  "drop-cast",
  "drop-tweet",
  "drop-follow-fc-10xmeme",
  "drop-follow-fc-10xchris",
  "drop-follow-x-10xmeme",
  "drop-follow-x-10xchris",
  "drop-join-fc-channel",
  "drop-join-telegram",
  "drop-waitlist-email",
  "drop-email-10x",
] as const;
const DROP_REWARD_REQUIRED_ACTIONS = 10;

function isSuccessfulCastVerification(verification: string | null): boolean {
  if (!verification) return false;
  return /^https:\/\/farcaster\.xyz\/[^/\s]+\/0x[a-f0-9]+$/i.test(verification.trim());
}

function isNeynarActionVerificationEnabled(env: Env): boolean {
  return env.ENABLE_NEYNAR_ACTION_VERIFICATION === "1";
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const ip = getClientIp(context.request);
  const ipRate = await rateLimit(context.env.WARPLETS_KV, "actions-complete-ip", ip, 60, 60);
  if (!ipRate.allowed) {
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "rate_limit",
      outcome: "actions_complete_rate_limited",
      actorType: "ip",
      ipAddress: ip,
      route: new URL(context.request.url).pathname,
    });
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(ipRate.retryAfterSeconds));
    return response;
  }

  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!isPlainObject(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  if (!hasOnlyAllowedKeys(parsed.value, ["actionSlug", "verification", "outreachTokenIds", "outreachRecipients", "sessionToken", "fid"])) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const body = parsed.value as RequestBody;

  const requestUrl = new URL(context.request.url);
  const sessionToken = asNonEmptyString(body.sessionToken);
  const bodyFid = asPositiveInteger(body.fid);
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, sessionToken);
  const isLocalDevHost =
    requestUrl.hostname.includes("-local.") ||
    requestUrl.hostname.includes("-dev.") ||
    requestUrl.hostname.endsWith(".pages.dev") ||
    requestUrl.hostname === "127.0.0.1" ||
    requestUrl.hostname === "localhost" ||
    requestUrl.hostname === "::1";
  const allowInsecureFallback =
    isLocalDevHost &&
    (context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK === "1" || isLocalDevHost);
  const fid = session.valid ? session.fid : (allowInsecureFallback ? bodyFid : null);
  if (!fid) {
    const authOutcome = session.valid ? "missing_fid_fallback" : session.reason;
    await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
      eventType: "actions_complete_auth",
      outcome: authOutcome,
      actorType: "ip",
      ipAddress: ip,
      route: requestUrl.pathname,
      details: "invalid_action_session",
    });
    return jsonSecure({ error: "Unauthorized action session" }, { status: 401 });
  }
  const actionSlug = asNonEmptyString(body.actionSlug)?.toLowerCase();
  const verification = asNonEmptyString(body.verification);
  const outreachTokenIds = asTokenIdList(body.outreachTokenIds);
  const outreachRecipients = asOutreachRecipients(body.outreachRecipients);

  if (!actionSlug) {
    return jsonSecure({ error: "actionSlug is required" }, { status: 400 });
  }
  const fidRate = await rateLimit(context.env.WARPLETS_KV, "actions-complete-fid", String(fid), 40, 60);
  if (!fidRate.allowed) {
    const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
    response.headers.set("retry-after", String(fidRate.retryAfterSeconds));
    return response;
  }

  if (sessionToken) {
    const sessionRate = await rateLimit(context.env.WARPLETS_KV, "actions-complete-session", sessionToken, 50, 60);
    if (!sessionRate.allowed) {
      const response = jsonSecure({ error: "Rate limit exceeded" }, { status: 429 });
      response.headers.set("retry-after", String(sessionRate.retryAfterSeconds));
      return response;
    }
  }

  const idempotencyKey = `actions-complete:${fid}:${actionSlug}:${verification ?? "none"}`;
  const idempotencyRate = await rateLimit(context.env.WARPLETS_KV, "actions-complete-idempotency", idempotencyKey, 1, 10);
  if (!idempotencyRate.allowed) {
    return jsonSecure({
      ok: true,
      fid,
      actionSlug,
      verification: verification ?? null,
      deduplicated: true,
    });
  }

  // Keep this lookup backward-compatible with local DBs that may not yet
  // include newer optional columns like `shared_on`.
  const user = await context.env.WARPLETS.prepare(
    "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number }>();

  if (!user) {
    return jsonSecure({ error: "Viewer record not found" }, { status: 404 });
  }

  const action = await context.env.WARPLETS.prepare(
    "SELECT id, slug, app_slug FROM actions WHERE slug = ? LIMIT 1"
  )
    .bind(actionSlug)
    .first<{ id: number; slug: string; app_slug: string }>();

  if (!action) {
    return jsonSecure({ error: "Action not found" }, { status: 404 });
  }

  if (
    isNeynarActionVerificationEnabled(context.env) &&
    (
      action.slug === "drop-follow-fc-10xmeme" ||
      action.slug === "drop-follow-fc-10xchris" ||
      action.slug === "drop-join-fc-channel"
    )
  ) {
    // Verification is best-effort only; never block completion persistence.
    const apiKey = context.env.NEYNAR_API_KEY?.trim();
    if (apiKey) {
      try {
        const verifyRes = await fetch(new URL("/api/actions-verify", context.request.url).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fid, actionSlug, sessionToken }),
        });

        if (!verifyRes.ok) {
          await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
            eventType: "actions_complete_verify",
            outcome: "verification_failed_non_blocking",
            actorType: "fid",
            actorId: String(fid),
            ipAddress: ip,
            route: requestUrl.pathname,
            details: action.slug,
          });
        }
      } catch {
        await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
          eventType: "actions_complete_verify",
          outcome: "verification_error_non_blocking",
          actorType: "fid",
          actorId: String(fid),
          ipAddress: ip,
          route: requestUrl.pathname,
          details: action.slug,
        });
      }
    }
  }

  const now = new Date().toISOString();

  if (action.slug === "drop-waitlist-email") {
    const waitlistRow = await context.env.WARPLETS.prepare(
      `SELECT email
       FROM email_waitlist
       WHERE fid = ?
         AND unsubscribed_at IS NULL
       ORDER BY subscribed_at DESC
       LIMIT 1`
    )
      .bind(fid)
      .first<{ email: string }>();

    if (!waitlistRow) {
      return jsonSecure({ error: "Waitlist email has not been submitted yet" }, { status: 409 });
    }
  }

  const completionInsert = await context.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO actions_completed (
       action_id, action_slug, user_id, user_fid, verification, created_on
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(action.id, action.slug, user.id, fid, verification, now)
    .run();
  const insertedCompletion = Number(completionInsert.meta.changes ?? 0) > 0;

  let allActionsCompleted = false;
  try {
    if (action.slug === "drop-cast" && isSuccessfulCastVerification(verification)) {
      // Best-effort only: older local schemas can miss `shared_on`.
      try {
        await context.env.WARPLETS.prepare(
          "UPDATE warplets_users SET shared_on = COALESCE(shared_on, ?), updated_on = ? WHERE id = ?"
        )
          .bind(now, now, user.id)
          .run();
      } catch {
        // Non-blocking for action completion.
      }
    }

    const outreachChannel =
      action.slug === "drop-cast" ? "farcaster" :
      action.slug === "drop-tweet" ? "x" :
      null;

    if (outreachChannel && insertedCompletion) {
      try {
        const channelRecipients = outreachRecipients.filter((recipient) =>
          outreachChannel === "farcaster"
            ? recipient.farcasterUsername.length > 0
            : Boolean(recipient.xUsername)
        );

        if (channelRecipients.length > 0) {
          const messageRow = await context.env.WARPLETS.prepare(
            `INSERT INTO warplets_outreach_messages (
               sender_user_id, sender_fid, action_slug, channel, verification, recipient_count, created_on
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             RETURNING id`
          )
            .bind(user.id, fid, action.slug, outreachChannel, verification, channelRecipients.length, now)
            .first<{ id: number }>();

          if (messageRow?.id) {
            await Promise.all(channelRecipients.map((recipient) =>
              context.env.WARPLETS.prepare(
                `INSERT INTO warplets_outreach_recipients (
                   message_id, sender_fid, recipient_fid, warplet_token_id, channel,
                   farcaster_username, x_username, mutual_affinity_score, source, created_on
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
                .bind(
                  messageRow.id,
                  fid,
                  recipient.fid,
                  recipient.tokenId,
                  outreachChannel,
                  recipient.farcasterUsername,
                  recipient.xUsername,
                  recipient.mutualAffinityScore,
                  recipient.source,
                  now
                )
                .run()
            ));
          }

          const tokenIds = channelRecipients.map((recipient) => recipient.tokenId);
          const placeholders = tokenIds.map(() => "?").join(", ");
          await context.env.WARPLETS.prepare(
            `UPDATE warplets_metadata
             SET last_outreach_on = ?,
                 outreach_count = COALESCE(outreach_count, 0) + 1
             WHERE token_id IN (${placeholders})`
          )
            .bind(now, ...tokenIds)
            .run();
        } else if (outreachTokenIds.length > 0) {
          const placeholders = outreachTokenIds.map(() => "?").join(", ");
          await context.env.WARPLETS.prepare(
            `UPDATE warplets_metadata
             SET last_outreach_on = ?
             WHERE token_id IN (${placeholders})`
          )
            .bind(now, ...outreachTokenIds)
            .run();
        }

        if (context.env.WARPLETS_KV) {
          await Promise.all([
            context.env.WARPLETS_KV.delete(`outreach-candidates-v1:${user.id}`),
            context.env.WARPLETS_KV.delete(`outreach-candidates-v2:${user.id}`),
          ]);
        }
      } catch (error) {
        console.error("actions-complete outreach tracking failed", {
          fid,
          actionSlug: action.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let totalActions = 0;
    let completedActions = 0;

    if (action.app_slug === "drop") {
      totalActions = DROP_REWARD_REQUIRED_ACTIONS;
      const placeholders = DROP_UNLOCK_ACTION_SLUGS.map(() => "?").join(", ");
      const completed = await context.env.WARPLETS.prepare(
        `SELECT COUNT(DISTINCT action_slug) AS completed_actions
         FROM actions_completed
         WHERE user_id = ?
           AND action_slug IN (${placeholders})`
      )
        .bind(user.id, ...DROP_UNLOCK_ACTION_SLUGS)
        .first<{ completed_actions: number }>();
      completedActions = Number(completed?.completed_actions ?? 0);
    } else {
      const totals = await context.env.WARPLETS.prepare(
        `SELECT
           (SELECT COUNT(*) FROM actions WHERE app_slug = ?) AS total_actions,
           (SELECT COUNT(*)
              FROM actions_completed ac
              JOIN actions a ON a.id = ac.action_id
             WHERE ac.user_id = ?
               AND a.app_slug = ?) AS completed_actions`
      )
        .bind(action.app_slug, user.id, action.app_slug)
        .first<{ total_actions: number; completed_actions: number }>();
      totalActions = Number(totals?.total_actions ?? 0);
      completedActions = Number(totals?.completed_actions ?? 0);
    }

    const hasWaitlistEntry = await context.env.WARPLETS.prepare(
      `SELECT 1
       FROM email_waitlist
       WHERE fid = ?
         AND unsubscribed_at IS NULL
       LIMIT 1`
    )
      .bind(fid)
      .first<{ 1: number }>();

    const hasWaitlistAction =
      action.app_slug === "drop"
        ? true
        : Boolean(
            await context.env.WARPLETS.prepare(
              "SELECT 1 FROM actions WHERE app_slug = ? AND slug = 'drop-waitlist-email' LIMIT 1"
            )
              .bind(action.app_slug)
              .first<{ 1: number }>()
          );

    if (hasWaitlistAction && hasWaitlistEntry) {
      const hasCompletionRow = await context.env.WARPLETS.prepare(
        `SELECT 1
         FROM actions_completed
         WHERE user_id = ?
           AND action_slug = 'drop-waitlist-email'
         LIMIT 1`
      )
        .bind(user.id)
        .first<{ 1: number }>();

      if (!hasCompletionRow) {
        completedActions += 1;
      }
    }

    allActionsCompleted = totalActions > 0 && completedActions >= totalActions;

    if (allActionsCompleted) {
      await context.env.WARPLETS.prepare(
        "UPDATE warplets_users SET rewarded_on = COALESCE(NULLIF(rewarded_on, ''), ?), updated_on = ? WHERE id = ?"
      )
        .bind(now, now, user.id)
        .run();
      if (context.env.WARPLETS_KV) {
        await Promise.all([
          context.env.WARPLETS_KV.delete("rewarded-users-v1:topup"),
          context.env.WARPLETS_KV.delete("rewarded-users-v1:rewarded-only"),
        ]);
      }
    }
  } catch (error) {
    console.error("actions-complete post-insert bookkeeping failed", {
      fid,
      actionSlug: action.slug,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await logSecurityEvent(context.env.WARPLETS, { logSalt: context.env.SECURITY_LOG_SALT }, {
    eventType: "actions_complete",
    outcome: "ok",
    actorType: "fid",
    actorId: String(fid),
    ipAddress: ip,
    route: requestUrl.pathname,
    details: action.slug,
  });

  return jsonSecure({
    ok: true,
    fid,
    actionSlug: action.slug,
    verification: verification ?? null,
    allActionsCompleted,
  });
};
