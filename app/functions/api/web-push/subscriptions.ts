import { getAppSession, type AppAuthEnv } from "../../_lib/appAuth.js";
import { resolveAppSlugFromUrl } from "../../_lib/appSlug.js";
import { jsonSecure, sha256Hex } from "../../_lib/security.js";

interface Env extends AppAuthEnv {}

interface SubscriptionBody {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  endpoint?: string;
  topics?: string[];
}

const VALID_TOPICS = new Set(["announcements", "favourites", "offers", "market", "activity", "launches"]);
const PERSONAL_TOPICS = new Set(["favourites", "offers", "launches"]);

function normalizeTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return ["announcements"];
  const topics = [...new Set(value.filter((item): item is string => typeof item === "string" && VALID_TOPICS.has(item)))];
  return topics.length ? topics : ["announcements"];
}

function validEndpoint(value: string): boolean {
  try {
    return new URL(value).protocol === "https:" && value.length <= 2048;
  } catch {
    return false;
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<SubscriptionBody>().catch((): SubscriptionBody => ({}));
  const endpoint = body.subscription?.endpoint?.trim() ?? "";
  const p256dh = body.subscription?.keys?.p256dh?.trim() ?? "";
  const auth = body.subscription?.keys?.auth?.trim() ?? "";
  if (!validEndpoint(endpoint) || !p256dh || p256dh.length > 256 || !auth || auth.length > 128) {
    return jsonSecure({ error: "Invalid Web Push subscription" }, { status: 400 });
  }
  const session = await getAppSession(request, env, { touch: false }).catch(() => null);
  const appSlug = resolveAppSlugFromUrl(new URL(request.url));
  const topics = normalizeTopics(body.topics);
  if (!session?.walletAddress && !session?.farcasterFid && topics.some((topic) => PERSONAL_TOPICS.has(topic))) {
    return jsonSecure({ error: "A verified identity is required for personal alerts" }, { status: 401 });
  }
  const endpointHash = await sha256Hex(endpoint);
  const timestamp = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO web_push_subscriptions (
       endpoint_hash, endpoint, p256dh, auth, wallet_address, farcaster_fid,
       topics_json, enabled, created_at, updated_at, failure_count, app_slug
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?)
     ON CONFLICT(endpoint_hash) DO UPDATE SET
       endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth,
       wallet_address = excluded.wallet_address, farcaster_fid = excluded.farcaster_fid,
       topics_json = excluded.topics_json, enabled = 1, updated_at = excluded.updated_at,
       failure_count = 0, app_slug = excluded.app_slug`,
  )
    .bind(
      endpointHash,
      endpoint,
      p256dh,
      auth,
      session?.walletAddress ?? null,
      session?.farcasterFid ?? null,
      JSON.stringify(topics),
      timestamp,
      timestamp,
      appSlug,
    )
    .run();
  return jsonSecure({ ok: true, appSlug, topics, identityLinked: Boolean(session?.walletAddress || session?.farcasterFid) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json<SubscriptionBody>().catch((): SubscriptionBody => ({}));
  const endpoint = body.endpoint?.trim() ?? "";
  if (!validEndpoint(endpoint)) return jsonSecure({ error: "Invalid Web Push endpoint" }, { status: 400 });
  const endpointHash = await sha256Hex(endpoint);
  await env.WARPLETS.prepare(
    "UPDATE web_push_subscriptions SET enabled = 0, updated_at = ? WHERE endpoint_hash = ?",
  ).bind(new Date().toISOString(), endpointHash).run();
  return jsonSecure({ ok: true });
};
