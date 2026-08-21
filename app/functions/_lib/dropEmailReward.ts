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

export async function syncDropWaitlistActionCompletion(
  db: D1Database,
  fid: number,
  email: string,
): Promise<void> {
  const user = await db.prepare("SELECT id FROM warplets_users WHERE fid = ? LIMIT 1")
    .bind(fid).first<{ id: number }>();
  if (!user) return;

  const action = await db.prepare(
    "SELECT id, slug FROM actions WHERE slug = 'drop-waitlist-email' AND app_slug = 'drop' LIMIT 1",
  ).first<{ id: number; slug: string }>();
  if (!action) return;

  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO actions_completed (
       action_id, action_slug, user_id, user_fid, verification, created_on
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(action.id, action.slug, user.id, fid, `email:${email}`, now).run();

  const placeholders = DROP_UNLOCK_ACTION_SLUGS.map(() => "?").join(", ");
  const completed = await db.prepare(
    `SELECT COUNT(DISTINCT action_slug) AS completed_actions
     FROM actions_completed
     WHERE user_id = ? AND action_slug IN (${placeholders})`,
  ).bind(user.id, ...DROP_UNLOCK_ACTION_SLUGS).first<{ completed_actions: number }>();

  if (Number(completed?.completed_actions ?? 0) >= DROP_REWARD_REQUIRED_ACTIONS) {
    await db.prepare(
      "UPDATE warplets_users SET rewarded_on = COALESCE(NULLIF(rewarded_on, ''), ?), updated_on = ? WHERE id = ?",
    ).bind(now, now, user.id).run();
  }
}
