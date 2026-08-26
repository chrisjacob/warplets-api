export type NotificationDeliveryChannel = "farcaster" | "base" | "web-push";

export async function recordNotificationChannelInteraction(
  db: D1Database,
  input: {
    campaignId: string;
    appSlug: string;
    channel: NotificationDeliveryChannel;
    recipientKey: string;
    action: "open" | "click";
  },
): Promise<void> {
  const now = new Date().toISOString();
  if (input.action === "click") {
    await db.prepare(
      `UPDATE notification_channel_deliveries
          SET clicked_at = COALESCE(clicked_at, ?),
              opened_at = COALESCE(opened_at, ?),
              updated_at = ?
        WHERE campaign_id = ? AND app_slug = ? AND channel = ?
          AND recipient_key = ? AND status = 'delivered'`,
    ).bind(now, now, now, input.campaignId, input.appSlug, input.channel, input.recipientKey).run();
    return;
  }
  await db.prepare(
    `UPDATE notification_channel_deliveries
        SET opened_at = COALESCE(opened_at, ?), updated_at = ?
      WHERE campaign_id = ? AND app_slug = ? AND channel = ?
        AND recipient_key = ? AND status = 'delivered'`,
  ).bind(now, now, input.campaignId, input.appSlug, input.channel, input.recipientKey).run();
}
