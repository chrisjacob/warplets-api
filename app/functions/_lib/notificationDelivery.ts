export const MAX_NOTIFICATION_DELIVERY_ATTEMPTS = 6;

export type NotificationChannelDeliveryStatus =
  | "pending"
  | "sending"
  | "delivered"
  | "failed"
  | "invalid"
  | "rate_limited";

export interface NotificationChannelDeliveryRow {
  id: number;
  channel: string;
  recipient_key: string;
  status: NotificationChannelDeliveryStatus;
  attempts: number;
  last_error: string | null;
}

export interface NotificationDeliveryClaim {
  id: number;
  status: NotificationChannelDeliveryStatus;
  attempts: number;
  claimed: boolean;
}

export async function claimNotificationChannelDelivery(
  db: D1Database,
  input: {
    campaignId: string;
    appSlug: string;
    channel: "base" | "web-push";
    recipientKey: string;
    farcasterFid?: number | null;
    walletAddress?: string | null;
    staleAfterMinutes?: number;
    maxAttempts?: number;
  },
): Promise<NotificationDeliveryClaim> {
  const now = new Date().toISOString();
  const staleBefore = new Date(
    Date.now() - (input.staleAfterMinutes ?? 10) * 60_000,
  ).toISOString();
  const maxAttempts = input.maxAttempts ?? MAX_NOTIFICATION_DELIVERY_ATTEMPTS;

  await db.prepare(
    `INSERT OR IGNORE INTO notification_channel_deliveries (
       campaign_id, app_slug, channel, recipient_key, farcaster_fid, wallet_address,
       status, attempts, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).bind(
    input.campaignId,
    input.appSlug,
    input.channel,
    input.recipientKey,
    input.farcasterFid ?? null,
    input.walletAddress ?? null,
    now,
    now,
  ).run();

  const claim = await db.prepare(
    `UPDATE notification_channel_deliveries
        SET status = 'sending', last_error = NULL, updated_at = ?
      WHERE campaign_id = ? AND app_slug = ? AND channel = ? AND recipient_key = ?
        AND attempts < ?
        AND (
          status IN ('pending', 'failed', 'rate_limited')
          OR (status = 'sending' AND updated_at <= ?)
        )`,
  ).bind(
    now,
    input.campaignId,
    input.appSlug,
    input.channel,
    input.recipientKey,
    maxAttempts,
    staleBefore,
  ).run();

  const row = await db.prepare(
    `SELECT id, status, attempts
       FROM notification_channel_deliveries
      WHERE campaign_id = ? AND app_slug = ? AND channel = ? AND recipient_key = ?
      LIMIT 1`,
  ).bind(input.campaignId, input.appSlug, input.channel, input.recipientKey)
    .first<{ id: number; status: NotificationChannelDeliveryStatus; attempts: number }>();
  if (!row) throw new Error("Notification channel delivery reservation failed");

  return {
    id: Number(row.id),
    status: row.status,
    attempts: Number(row.attempts || 0),
    claimed: Number(claim.meta.changes || 0) === 1,
  };
}

export async function getCampaignChannelDeliveries(
  db: D1Database,
  campaignId: string,
  appSlug: string,
): Promise<NotificationChannelDeliveryRow[]> {
  const result = await db.prepare(
    `SELECT id, channel, recipient_key, status, attempts, last_error
       FROM notification_channel_deliveries
      WHERE campaign_id = ? AND app_slug = ?`,
  ).bind(campaignId, appSlug).all<NotificationChannelDeliveryRow>();
  return result.results ?? [];
}

export function notificationDeliveryNeedsRetry(
  delivery: Pick<NotificationChannelDeliveryRow, "status" | "attempts">,
  maxAttempts = MAX_NOTIFICATION_DELIVERY_ATTEMPTS,
): boolean {
  return (
    delivery.attempts < maxAttempts &&
    ["pending", "sending", "failed", "rate_limited"].includes(delivery.status)
  );
}
