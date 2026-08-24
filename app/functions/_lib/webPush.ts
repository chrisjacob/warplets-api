import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from "./workerWebPush.js";
import type { AppSlug } from "./appSlug.js";

export interface WebPushEnv {
  WARPLETS: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface WebPushSubscriptionRow {
  endpoint_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  app_slug: AppSlug;
  farcaster_fid: number | null;
  wallet_address: string | null;
}

export interface WebPushSendInput {
  campaignId: string;
  title: string;
  body: string;
  targetUrl: string;
  appSlug: AppSlug;
}

export interface WebPushSendResult {
  channel: "web-push";
  endpointHash: string;
  fid?: number;
  wallet?: string;
  state: "delivered" | "failed" | "invalid" | "rate_limited" | "skipped_existing";
  responseStatus?: number;
  error?: string;
}

function requireVapidKeys(env: WebPushEnv): VapidKeys {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured with VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT");
  }
  return { publicKey, privateKey, subject };
}

export function classifyWebPushResponse(status: number): WebPushSendResult["state"] {
  if (status >= 200 && status < 300) return "delivered";
  if (status === 404 || status === 410) return "invalid";
  if (status === 429) return "rate_limited";
  return "failed";
}

async function reserveDelivery(
  env: WebPushEnv,
  subscription: WebPushSubscriptionRow,
  input: WebPushSendInput,
): Promise<{ id: number; status: string }> {
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT OR IGNORE INTO notification_channel_deliveries (
       campaign_id, app_slug, channel, recipient_key, farcaster_fid, wallet_address,
       status, attempts, created_at, updated_at
     ) VALUES (?, ?, 'web-push', ?, ?, ?, 'pending', 0, ?, ?)`,
  ).bind(
    input.campaignId,
    input.appSlug,
    subscription.endpoint_hash,
    subscription.farcaster_fid,
    subscription.wallet_address,
    now,
    now,
  ).run();

  const delivery = await env.WARPLETS.prepare(
    `SELECT id, status FROM notification_channel_deliveries
      WHERE campaign_id = ? AND app_slug = ? AND channel = 'web-push' AND recipient_key = ?`,
  ).bind(input.campaignId, input.appSlug, subscription.endpoint_hash).first<{ id: number; status: string }>();
  if (!delivery) throw new Error("Web Push delivery reservation failed");
  return delivery;
}

async function recordAttempt(
  env: WebPushEnv,
  deliveryId: number,
  subscription: WebPushSubscriptionRow,
  state: WebPushSendResult["state"],
  responseStatus: number | null,
  error: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await env.WARPLETS.batch([
    env.WARPLETS.prepare(
      `UPDATE notification_channel_deliveries
          SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(state, error, now, deliveryId),
    env.WARPLETS.prepare(
      `INSERT INTO notification_channel_attempts (
         delivery_id, response_status, result, error_message, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(deliveryId, responseStatus, state, error, now),
    state === "delivered"
      ? env.WARPLETS.prepare(
        `UPDATE web_push_subscriptions
            SET last_success_at = ?, updated_at = ?, failure_count = 0
          WHERE endpoint_hash = ?`,
      ).bind(now, now, subscription.endpoint_hash)
      : env.WARPLETS.prepare(
        `UPDATE web_push_subscriptions
            SET enabled = CASE WHEN ? = 'invalid' THEN 0 ELSE enabled END,
                last_failure_at = ?, updated_at = ?, failure_count = failure_count + 1
          WHERE endpoint_hash = ?`,
      ).bind(state, now, now, subscription.endpoint_hash),
  ]);
}

export async function sendWebPushNotification(
  env: WebPushEnv,
  subscription: WebPushSubscriptionRow,
  input: WebPushSendInput,
): Promise<WebPushSendResult> {
  const delivery = await reserveDelivery(env, subscription, input);
  const identity = {
    ...(subscription.farcaster_fid ? { fid: subscription.farcaster_fid } : {}),
    ...(subscription.wallet_address ? { wallet: subscription.wallet_address } : {}),
  };
  if (delivery.status === "delivered") {
    return { channel: "web-push", endpointHash: subscription.endpoint_hash, ...identity, state: "skipped_existing" };
  }

  try {
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    const payload = await buildPushPayload({
      data: JSON.stringify({
        title: input.title,
        body: input.body,
        url: input.targetUrl,
        notificationId: input.campaignId,
        recipientKey: subscription.endpoint_hash,
        appSlug: input.appSlug,
        icon: input.appSlug === "warplets" ? "/icon_search.png" : "/icon.png",
        badge: input.appSlug === "warplets" ? "/splash_search.png" : "/splash.png",
      }),
      options: { ttl: 86_400, urgency: "normal" },
    }, pushSubscription, requireVapidKeys(env));
    const response = await fetch(subscription.endpoint, {
      method: payload.method,
      headers: payload.headers,
      body: payload.body.slice().buffer as ArrayBuffer,
    });
    const state = classifyWebPushResponse(response.status);
    const error = state === "delivered" ? null : `Push service returned HTTP ${response.status}`;
    await recordAttempt(env, delivery.id, subscription, state, response.status, error);
    return {
      channel: "web-push",
      endpointHash: subscription.endpoint_hash,
      ...identity,
      state,
      responseStatus: response.status,
      ...(error ? { error } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAttempt(env, delivery.id, subscription, "failed", null, message);
    return { channel: "web-push", endpointHash: subscription.endpoint_hash, ...identity, state: "failed", error: message };
  }
}
