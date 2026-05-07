interface Env {
  WARPLETS: D1Database;
}

interface RequestBody {
  fid?: unknown;
  actionSlug?: unknown;
  verification?: unknown;
  outreachTokenIds?: unknown;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asTokenIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)
    .slice(0, 10);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = asPositiveInt(body.fid);
  const actionSlug = asNonEmptyString(body.actionSlug)?.toLowerCase();
  const verification = asNonEmptyString(body.verification);
  const outreachTokenIds = asTokenIdList(body.outreachTokenIds);

  if (!fid || !actionSlug) {
    return Response.json({ error: "fid and actionSlug are required" }, { status: 400 });
  }

  const user = await context.env.WARPLETS.prepare(
    "SELECT id, shared_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; shared_on: string | null }>();

  if (!user) {
    return Response.json({ error: "Viewer record not found" }, { status: 404 });
  }

  const action = await context.env.WARPLETS.prepare(
    "SELECT id, slug, app_slug FROM actions WHERE slug = ? LIMIT 1"
  )
    .bind(actionSlug)
    .first<{ id: number; slug: string; app_slug: string }>();

  if (!action) {
    return Response.json({ error: "Action not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (action.slug === "drop-waitlist-email") {
    const verifiedRow = await context.env.WARPLETS.prepare(
      `SELECT email, verified
       FROM email_waitlist
       WHERE fid = ?
         AND verified = 1
         AND unsubscribed_at IS NULL
       ORDER BY subscribed_at DESC
       LIMIT 1`
    )
      .bind(fid)
      .first<{ email: string; verified: number }>();

    if (!verifiedRow) {
      return Response.json({ error: "Waitlist email is not verified yet" }, { status: 409 });
    }
  }

  await context.env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO actions_completed (
       action_id, action_slug, user_id, user_fid, verification, created_on
     ) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(action.id, action.slug, user.id, fid, verification, now)
    .run();

  if (action.slug === "drop-cast" && verification && !user.shared_on) {
    await context.env.WARPLETS.prepare(
      "UPDATE warplets_users SET shared_on = ?, updated_on = ? WHERE id = ?"
    )
      .bind(now, now, user.id)
      .run();
  }

  if (action.slug === "drop-cast" && verification && outreachTokenIds.length > 0) {
    const placeholders = outreachTokenIds.map(() => "?").join(", ");
    await context.env.WARPLETS.prepare(
      `UPDATE warplets_metadata
       SET last_outreach_on = ?
       WHERE token_id IN (${placeholders})`
    )
      .bind(now, ...outreachTokenIds)
      .run();
  }

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

  const totalActions = Number(totals?.total_actions ?? 0);
  let completedActions = Number(totals?.completed_actions ?? 0);

  const hasVerifiedWaitlist = await context.env.WARPLETS.prepare(
    `SELECT 1
     FROM email_waitlist
     WHERE fid = ?
       AND verified = 1
       AND unsubscribed_at IS NULL
     LIMIT 1`
  )
    .bind(fid)
    .first<{ 1: number }>();

  const hasWaitlistAction = await context.env.WARPLETS.prepare(
    "SELECT 1 FROM actions WHERE app_slug = ? AND slug = 'drop-waitlist-email' LIMIT 1"
  )
    .bind(action.app_slug)
    .first<{ 1: number }>();

  if (hasWaitlistAction && hasVerifiedWaitlist) {
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

  const allActionsCompleted = totalActions > 0 && completedActions >= totalActions;

  if (allActionsCompleted) {
    await context.env.WARPLETS.prepare(
      "UPDATE warplets_users SET rewarded_on = COALESCE(rewarded_on, ?), updated_on = ? WHERE id = ?"
    )
      .bind(now, now, user.id)
      .run();
  }

  return Response.json({
    ok: true,
    fid,
    actionSlug: action.slug,
    verification: verification ?? null,
    allActionsCompleted,
  });
};
