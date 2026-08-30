import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFICATION_BATCH_LIMIT,
  buildProgress,
  selectAdminNotificationBatch,
} from "./send";

describe("admin notification batching", () => {
  const recipients = Array.from({ length: 1431 }, (_, index) => index + 1);

  it("caps both manual and automatic audience sends to one resumable request batch", () => {
    expect(selectAdminNotificationBatch(recipients, "batch")).toHaveLength(ADMIN_NOTIFICATION_BATCH_LIMIT);
    expect(selectAdminNotificationBatch(recipients, "all")).toHaveLength(ADMIN_NOTIFICATION_BATCH_LIMIT);
  });

  it("preserves an already validated targeted FID list", () => {
    expect(selectAdminNotificationBatch(recipients.slice(0, 3), "fids")).toEqual([1, 2, 3]);
  });
});

describe("admin multi-channel progress", () => {
  it("counts every selected channel recipient and its persisted delivery state", () => {
    const progress = buildProgress({
      channels: ["farcaster", "base", "web-push"],
      farcasterRows: [{
        fid: 1129138,
        app_slug: "warplets",
        notification_url: "https://example.com/notify",
        notification_token: "token",
      }],
      dispatchRows: [{ fid: 1129138, status: "delivered" }],
      webPushRows: [{
        endpoint_hash: "a".repeat(64),
        endpoint: "https://push.example/subscription",
        p256dh: "key",
        auth: "auth",
        app_slug: "warplets",
        farcaster_fid: 1129138,
        wallet_address: null,
      }],
      baseWallets: ["0x1111111111111111111111111111111111111111"],
      channelDeliveryRows: [
        { channel: "base", recipient_key: "0x1111111111111111111111111111111111111111", status: "invalid" },
        { channel: "web-push", recipient_key: "a".repeat(64), status: "delivered" },
      ],
    });

    expect(progress).toMatchObject({
      audience: 3,
      alreadyDispatched: 3,
      unsent: 0,
      delivered: 2,
      invalid: 1,
    });
    expect(progress.byChannel).toMatchObject({
      farcaster: { audience: 1, delivered: 1 },
      base: { audience: 1, invalid: 1 },
      "web-push": { audience: 1, delivered: 1 },
    });
  });

  it("includes Base recipients discovered from an existing full-audience campaign", () => {
    const progress = buildProgress({
      channels: ["base"],
      farcasterRows: [],
      dispatchRows: [],
      webPushRows: [],
      channelDeliveryRows: [{
        channel: "base",
        recipient_key: "0x2222222222222222222222222222222222222222",
        status: "delivered",
      }],
    });

    expect(progress).toMatchObject({ audience: 1, delivered: 1, unsent: 0 });
  });
});
