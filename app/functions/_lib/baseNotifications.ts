import { WARPLETS_APP_ORIGINS, WARPLETS_APP_SLUG } from "../../shared/warpletsApp.js";
import { getDefaultLaunchUrl, type AppSlug } from "./appSlug.js";
import { claimNotificationChannelDelivery } from "./notificationDelivery.js";

export interface BaseNotificationsEnv {
  WARPLETS: D1Database;
  BASE_NOTIFICATIONS_API_KEY?: string;
  BASE_APP_NOTIFICATIONS_API_KEY?: string;
  BASE_STONKLETS_NOTIFICATIONS_API_KEY?: string;
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

const PERMANENT_DELIVERY_FAILURES = [
  "user has not saved this app",
  "notifications are not enabled",
  "notifications disabled",
  "invalid wallet",
] as const;

export function isPermanentBaseNotificationFailure(error: unknown): boolean {
  if (typeof error !== "string") return false;
  const normalized = error.trim().toLowerCase();
  return PERMANENT_DELIVERY_FAILURES.some((message) => normalized.includes(message));
}

const BASE_NOTIFICATIONS_ORIGIN = "https://dashboard.base.org";
const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
const BASE_REQUEST_SPACING_MS = 3100;

export interface BaseRequestPacer {
  lastRequestAt: number;
}

export function createBaseRequestPacer(): BaseRequestPacer {
  return { lastRequestAt: 0 };
}

export type BaseNotificationSendState =
  | "delivered"
  | "failed"
  | "invalid"
  | "skipped_existing"
  | "skipped_in_flight"
  | "exhausted";

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
  if (appSlug === "stonklets") {
    return {
      apiKey: env.BASE_STONKLETS_NOTIFICATIONS_API_KEY?.trim() || null,
      appUrl: getDefaultLaunchUrl("stonklets"),
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
  pacer: BaseRequestPacer = { lastRequestAt: 0 },
): Promise<Response> {
  const { apiKey } = requireConfig(env, appSlug);
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waitMs = Math.max(0, BASE_REQUEST_SPACING_MS - (Date.now() - pacer.lastRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    pacer.lastRequestAt = Date.now();
    response = await fetch(`${BASE_NOTIFICATIONS_ORIGIN}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(10_000),
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

/** One bounded page for resumable scheduled campaigns. */
export async function getBaseNotificationAudiencePage(env: BaseNotificationsEnv, appSlug: AppSlug, cursor = "") {
  const { appUrl } = requireConfig(env, appSlug);
  const query = new URLSearchParams({ app_url: appUrl, notification_enabled: "true", limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const response = await baseFetch(env, appSlug, `/api/v1/notifications/app/users?${query}`);
  if (!response.ok) throw new Error(`Base notification audience failed (${response.status})`);
  const payload = await response.json() as BaseAudienceResponse;
  return {
    wallets: (payload.users ?? []).filter(user => user.notificationsEnabled === true).map(user => normalizeWallet(user.address)).filter((wallet): wallet is string => wallet !== null),
    nextCursor: typeof payload.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
  };
}

export async function getBaseNotificationAudience(
  env: BaseNotificationsEnv,
  appSlug: AppSlug = WARPLETS_APP_SLUG,
  pacer: BaseRequestPacer = createBaseRequestPacer(),
): Promise<string[]> {
  const { appUrl } = requireConfig(env, appSlug);
  const wallets = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ app_url: appUrl, notification_enabled: "true", limit: "500" });
    if (cursor) query.set("cursor", cursor);
    const response = await baseFetch(env, appSlug, `/api/v1/notifications/app/users?${query.toString()}`, {}, pacer);
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
): Promise<Awaited<ReturnType<typeof claimNotificationChannelDelivery>>> {
  return claimNotificationChannelDelivery(env.WARPLETS, {
    campaignId,
    appSlug,
    channel: "base",
    recipientKey: wallet,
    walletAddress: wallet,
  });
}

export async function sendBaseNotificationCampaign(env: BaseNotificationsEnv, input: {
  campaignId: string;
  appSlug?: AppSlug;
  wallets?: string[];
  title: string;
  message: string;
  targetPath?: string;
  pacer?: BaseRequestPacer;
}): Promise<Array<{ wallet: string; state: BaseNotificationSendState; error?: string }>> {
  const appSlug = input.appSlug ?? WARPLETS_APP_SLUG;
  const { appUrl } = requireConfig(env, appSlug);
  const pacer = input.pacer ?? createBaseRequestPacer();
  const sourceWallets = input.wallets !== undefined ? input.wallets : await getBaseNotificationAudience(env, appSlug, pacer);
  const uniqueWallets = [...new Set(sourceWallets.map(normalizeWallet).filter((value): value is string => Boolean(value)))];
  const reserved: Array<{ wallet: string; id: number }> = [];
  const results: Array<{ wallet: string; state: BaseNotificationSendState; error?: string }> = [];
  for (const wallet of uniqueWallets) {
    const delivery = await reserveDelivery(env, input.campaignId, wallet, appSlug);
    if (delivery.claimed) {
      reserved.push({ wallet, id: delivery.id });
    } else if (delivery.status === "delivered") {
      results.push({ wallet, state: "skipped_existing" });
    } else if (delivery.status === "sending") {
      results.push({ wallet, state: "skipped_in_flight" });
    } else {
      results.push({ wallet, state: "exhausted", error: "Delivery retry limit reached" });
    }
  }

  for (let index = 0; index < reserved.length; index += 1000) {
    const batch = reserved.slice(index, index + 1000);
    const target = new URL(input.targetPath || "/", appUrl);
    target.searchParams.set("baseNotificationId", input.campaignId);
    let response: Response;
    try {
      response = await baseFetch(env, appSlug, "/api/v1/notifications/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_url: appUrl,
          wallet_addresses: batch.map((row) => row.wallet),
          title: input.title.slice(0, 30),
          message: input.message.slice(0, 200),
          target_path: `${target.pathname}${target.search}`.slice(0, 500),
        }),
      }, pacer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      for (const row of batch) {
        await env.WARPLETS.batch([
          env.WARPLETS.prepare(
            `UPDATE notification_channel_deliveries
                SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
              WHERE id = ? AND status = 'sending'`,
          ).bind(message, now, row.id),
          env.WARPLETS.prepare(
            `INSERT INTO notification_channel_attempts (delivery_id, response_status, result, error_message, created_at)
             VALUES (?, NULL, 'failed', ?, ?)`,
          ).bind(row.id, message, now),
        ]);
        results.push({ wallet: row.wallet, state: "failed", error: message });
      }
      continue;
    }
    let payload: BaseSendResponse = {};
    try { payload = await response.json() as BaseSendResponse; } catch { /* recorded below */ }
    const byWallet = new Map((payload.results ?? []).map((row) => [normalizeWallet(row.walletAddress), row]));
    for (const row of batch) {
      const item = byWallet.get(row.wallet);
      const sent = response.ok && item?.sent === true;
      const error = typeof item?.failureReason === "string" ? item.failureReason : response.ok ? "unknown delivery failure" : `HTTP ${response.status}`;
      const state: BaseNotificationSendState = sent
        ? "delivered"
        : isPermanentBaseNotificationFailure(error)
        ? "invalid"
        : "failed";
      const now = new Date().toISOString();
      await env.WARPLETS.prepare(
        `UPDATE notification_channel_deliveries
         SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`,
      ).bind(state, sent ? null : error, now, row.id).run();
      await env.WARPLETS.prepare(
        `INSERT INTO notification_channel_attempts (delivery_id, response_status, result, error_message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(row.id, response.status, state, sent ? null : error, now).run();
      if (state === "delivered" || state === "invalid") {
        await env.WARPLETS.prepare(
          `INSERT INTO base_notification_status_cache (
             wallet_address, app_url, app_pinned, notifications_enabled, checked_at, response_json
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(wallet_address) DO UPDATE SET
             app_url = excluded.app_url,
             notifications_enabled = excluded.notifications_enabled,
             checked_at = excluded.checked_at,
             response_json = excluded.response_json`,
        ).bind(
          row.wallet,
          appUrl,
          sent ? 1 : 0,
          sent ? 1 : 0,
          now,
          JSON.stringify({ source: "notification_send", state, error: sent ? null : error }),
        ).run();
      }
      results.push({ wallet: row.wallet, state, ...(sent ? {} : { error }) });
    }
  }
  return results;
}
