import { WARPLETS_APP_ORIGINS, WARPLETS_APP_SLUG } from "../../shared/warpletsApp.js";
import { getDefaultLaunchUrl, type AppSlug } from "./appSlug.js";

export interface BaseNotificationsEnv {
  WARPLETS: D1Database;
  BASE_NOTIFICATIONS_API_KEY?: string;
  BASE_APP_NOTIFICATIONS_API_KEY?: string;
  BASE_NOTIFICATIONS_ENABLED?: string;
  BASE_APP_URL?: string;
}

export interface BaseNotificationStatus {
  appPinned: boolean;
  notificationsEnabled: boolean;
}

interface BaseAudienceResponse {
  success?: boolean;
  users?: Array<{ address?: unknown; notificationsEnabled?: unknown }>;
  nextCursor?: unknown;
}

interface BaseSendResponse {
  success?: boolean;
  results?: Array<{ walletAddress?: unknown; sent?: unknown; failureReason?: unknown }>;
  sentCount?: number;
  failedCount?: number;
}

const BASE_NOTIFICATIONS_ORIGIN = "https://dashboard.base.org";
const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
const BASE_REQUEST_SPACING_MS = 3100;
let lastBaseRequestAt = 0;

export function resolveBaseNotificationConfig(
  env: BaseNotificationsEnv,
  appSlug: AppSlug,
): { apiKey: string | null; appUrl: string } {
  if (appSlug === "app") {
    return {
      apiKey: env.BASE_APP_NOTIFICATIONS_API_KEY?.trim() || null,
      appUrl: getDefaultLaunchUrl("app"),
    };
  }
  if (appSlug === WARPLETS_APP_SLUG) {
    return {
      apiKey: env.BASE_NOTIFICATIONS_API_KEY?.trim() || null,
      appUrl: env.BASE_APP_URL?.trim() || WARPLETS_APP_ORIGINS.prod,
    };
  }
  return { apiKey: null, appUrl: getDefaultLaunchUrl(appSlug) };
}

function requireConfig(env: BaseNotificationsEnv, appSlug: AppSlug): { apiKey: string; appUrl: string } {
  if (env.BASE_NOTIFICATIONS_ENABLED !== "true") throw new Error("Base notifications are disabled");
  const { apiKey, appUrl } = resolveBaseNotificationConfig(env, appSlug);
  if (!apiKey) throw new Error(`Base notifications are not configured for ${appSlug}`);
  return { apiKey, appUrl };
}

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return WALLET_PATTERN.test(normalized) ? normalized : null;
}

async function baseFetch(
  env: BaseNotificationsEnv,
  appSlug: AppSlug,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { apiKey } = requireConfig(env, appSlug);
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waitMs = Math.max(0, BASE_REQUEST_SPACING_MS - (Date.now() - lastBaseRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastBaseRequestAt = Date.now();
    response = await fetch(`${BASE_NOTIFICATIONS_ORIGIN}${path}`, {
      ...init,
      headers: { accept: "application/json", "x-api-key": apiKey, ...(init.headers ?? {}) },
    });
    if (response.status !== 429 && response.status !== 503) return response;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
  }
  return response as Response;
}

export async function getBaseNotificationStatus(
  env: BaseNotificationsEnv,
  wallet: string,
  appSlug: AppSlug = WARPLETS_APP_SLUG,
): Promise<BaseNotificationStatus> {
  const normalized = normalizeWallet(wallet);
  if (!normalized) throw new Error("A valid wallet is required");
  const { appUrl } = requireConfig(env, appSlug);
  const response = await baseFetch(env, appSlug, "/api/v1/notifications/app/user/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_url: appUrl, wallet_address: normalized }),
  });
  if (!response.ok) throw new Error(`Base notification status failed (${response.status})`);
  const payload = await response.json() as BaseNotificationStatus;
  return { appPinned: payload.appPinned === true, notificationsEnabled: payload.notificationsEnabled === true };
}

export async function getBaseNotificationAudience(
  env: BaseNotificationsEnv,
  appSlug: AppSlug = WARPLETS_APP_SLUG,
): Promise<string[]> {
  const { appUrl } = requireConfig(env, appSlug);
  const wallets = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ app_url: appUrl, notification_enabled: "true", limit: "500" });
    if (cursor) query.set("cursor", cursor);
    const response = await baseFetch(env, appSlug, `/api/v1/notifications/app/users?${query.toString()}`);
    if (!response.ok) throw new Error(`Base notification audience failed (${response.status})`);
    const payload = await response.json() as BaseAudienceResponse;
    for (const user of payload.users ?? []) {
      if (user.notificationsEnabled !== true) continue;
      const wallet = normalizeWallet(user.address);
      if (wallet) wallets.add(wallet);
    }
    cursor = typeof payload.nextCursor === "string" ? payload.nextCursor : "";
    if (!cursor) break;
  }
  return [...wallets];
}

async function reserveDelivery(
  env: BaseNotificationsEnv,
  campaignId: string,
  wallet: string,
  appSlug: string,
): Promise<number | null> {
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO notification_channel_deliveries (
       campaign_id, app_slug, channel, recipient_key, wallet_address, status, attempts, created_at, updated_at
     ) VALUES (?, ?, 'base', ?, ?, 'pending', 0, ?, ?)`,
  ).bind(campaignId, appSlug, wallet, wallet, now, now).run();
  const row = await env.WARPLETS.prepare(
    `SELECT id, status FROM notification_channel_deliveries
     WHERE campaign_id = ? AND app_slug = ? AND channel = 'base' AND recipient_key = ? LIMIT 1`,
  ).bind(campaignId, appSlug, wallet).first<{ id: number; status: string }>();
  if (row?.status !== "pending" && row?.status !== "failed") return null;
  if (row.status === "failed") {
    await env.WARPLETS.prepare(
      "UPDATE notification_channel_deliveries SET status = 'pending', updated_at = ? WHERE id = ?",
    ).bind(now, row.id).run();
  }
  return Number(row.id);
}

export async function sendBaseNotificationCampaign(env: BaseNotificationsEnv, input: {
  campaignId: string;
  appSlug?: AppSlug;
  wallets?: string[];
  title: string;
  message: string;
  targetPath?: string;
}): Promise<Array<{ wallet: string; state: string; error?: string }>> {
  const appSlug = input.appSlug ?? WARPLETS_APP_SLUG;
  const { appUrl } = requireConfig(env, appSlug);
  const sourceWallets = input.wallets?.length ? input.wallets : await getBaseNotificationAudience(env, appSlug);
  const uniqueWallets = [...new Set(sourceWallets.map(normalizeWallet).filter((value): value is string => Boolean(value)))];
  const reserved: Array<{ wallet: string; id: number }> = [];
  for (const wallet of uniqueWallets) {
    const id = await reserveDelivery(env, input.campaignId, wallet, appSlug);
    if (id) reserved.push({ wallet, id });
  }
  const results: Array<{ wallet: string; state: string; error?: string }> = [];

  for (let index = 0; index < reserved.length; index += 1000) {
    const batch = reserved.slice(index, index + 1000);
    const target = new URL(input.targetPath || "/", appUrl);
    target.searchParams.set("baseNotificationId", input.campaignId);
    const response = await baseFetch(env, appSlug, "/api/v1/notifications/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_url: appUrl,
        wallet_addresses: batch.map((row) => row.wallet),
        title: input.title.slice(0, 30),
        message: input.message.slice(0, 200),
        target_path: `${target.pathname}${target.search}`.slice(0, 500),
      }),
    });
    let payload: BaseSendResponse = {};
    try { payload = await response.json() as BaseSendResponse; } catch { /* recorded below */ }
    const byWallet = new Map((payload.results ?? []).map((row) => [normalizeWallet(row.walletAddress), row]));
    for (const row of batch) {
      const item = byWallet.get(row.wallet);
      const sent = response.ok && item?.sent === true;
      const error = typeof item?.failureReason === "string" ? item.failureReason : response.ok ? "unknown delivery failure" : `HTTP ${response.status}`;
      const now = new Date().toISOString();
      await env.WARPLETS.prepare(
        `UPDATE notification_channel_deliveries
         SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`,
      ).bind(sent ? "delivered" : "failed", sent ? null : error, now, row.id).run();
      await env.WARPLETS.prepare(
        `INSERT INTO notification_channel_attempts (delivery_id, response_status, result, error_message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(row.id, response.status, sent ? "delivered" : "failed", sent ? null : error, now).run();
      results.push({ wallet: row.wallet, state: sent ? "delivered" : "failed", ...(sent ? {} : { error }) });
    }
  }
  return results;
}
