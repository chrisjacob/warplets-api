interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV: KVNamespace;
}

type ActionRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  app_action: string | null;
  app_action_content: string | null;
  app_action_embeds: string | null;
  url: string | null;
  image: string | null;
  verification_method: string;
  app_slug: string;
};

type CachedAction = {
  id: number;
  slug: string;
  name: string;
  description: string;
  appAction: string | null;
  appActionContent: string | null;
  appActionEmbeds: string[];
  url: string | null;
  image: string | null;
  verificationMethod: string;
  appSlug: string;
};

type WaitlistCompletion = {
  completed: boolean;
  verification: string | null;
};

function asPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseEmbeds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, 2);
  } catch {
    return [];
  }
}

async function loadActionsCached(env: Env, appSlug: string): Promise<CachedAction[]> {
  const cacheKey = `reward-actions:v1:${appSlug}`;
  const cached = await env.WARPLETS_KV.get(cacheKey, "json");

  if (Array.isArray(cached)) {
    return cached as CachedAction[];
  }

  const result = await env.WARPLETS.prepare(
    `SELECT id, slug, name, description, app_action, app_action_content, app_action_embeds,
            url, image, verification_method, app_slug
     FROM actions
     WHERE app_slug = ?
     ORDER BY id ASC`
  )
    .bind(appSlug)
    .all<ActionRow>();

  const actions = (result.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    appAction: row.app_action,
    appActionContent: row.app_action_content,
    appActionEmbeds: parseEmbeds(row.app_action_embeds),
    url: row.url,
    image: row.image,
    verificationMethod: row.verification_method,
    appSlug: row.app_slug,
  }));

  await env.WARPLETS_KV.put(cacheKey, JSON.stringify(actions), {
    expirationTtl: 600,
  });

  return actions;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const appSlug = (url.searchParams.get("appSlug") || "").trim().toLowerCase();
  const fid = asPositiveInt(url.searchParams.get("fid"));

  if (!appSlug) {
    return Response.json({ error: "appSlug is required" }, { status: 400 });
  }

  const actions = await loadActionsCached(context.env, appSlug);

  if (!fid) {
    return Response.json({ actions });
  }

  const user = await context.env.WARPLETS.prepare(
    "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number }>();

  if (!user) {
    return Response.json({ actions });
  }

  const completions = await context.env.WARPLETS.prepare(
    `SELECT action_slug, verification
     FROM actions_completed
     WHERE user_id = ?`
  )
    .bind(user.id)
    .all<{ action_slug: string; verification: string | null }>();

  const completionBySlug = new Map(
    (completions.results ?? []).map((row) => [row.action_slug, row.verification] as const)
  );

  const waitlistRow = await context.env.WARPLETS.prepare(
    `SELECT email, verified
     FROM email_waitlist
     WHERE fid = ?
       AND unsubscribed_at IS NULL
     ORDER BY subscribed_at DESC
     LIMIT 1`
  )
    .bind(fid)
    .first<{ email: string; verified: number }>();

  const waitlistCompletion: WaitlistCompletion = waitlistRow && waitlistRow.verified === 1
    ? { completed: true, verification: `email:${waitlistRow.email}` }
    : { completed: false, verification: null };

  const actionsWithCompletion = actions.map((action) => ({
    ...action,
    completed: action.slug === "drop-waitlist-email"
      ? waitlistCompletion.completed
      : completionBySlug.has(action.slug),
    verification: action.slug === "drop-waitlist-email"
      ? waitlistCompletion.verification
      : (completionBySlug.get(action.slug) ?? null),
  }));

  return Response.json({ actions: actionsWithCompletion });
};
