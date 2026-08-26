import { describe, expect, it } from "vitest";
import { recordNotificationChannelInteraction } from "./notificationChannelTracking";

describe("notification channel interaction tracking", () => {
  it.each([
    ["farcaster", "1129138"],
    ["base", "0x1111111111111111111111111111111111111111"],
    ["web-push", "a".repeat(64)],
  ] as const)("records %s clicks independently", async (channel, recipientKey) => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return { async run() { return {}; } };
          },
        };
      },
    } as unknown as D1Database;

    await recordNotificationChannelInteraction(db, {
      campaignId: "warplets:global-stats:2026-08-26",
      appSlug: "warplets",
      channel,
      recipientKey,
      action: "click",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("clicked_at");
    expect(calls[0].values.slice(-4)).toEqual([
      "warplets:global-stats:2026-08-26",
      "warplets",
      channel,
      recipientKey,
    ]);
  });
});
