import { describe, expect, it } from "vitest";
import {
  activityNotificationDisposition,
  buildGlobalStatsAudience,
  GLOBAL_STATS_TARGET_URL,
  isWebPushSubscriptionEligible,
  upsertActiveItemOffer,
} from "./warpletNotifications";
import type { WebPushSubscriptionRow } from "./webPush";

function webPushSubscription(overrides: Partial<WebPushSubscriptionRow> = {}): WebPushSubscriptionRow {
  return {
    endpoint_hash: "a".repeat(64),
    endpoint: "https://push.example/subscription",
    p256dh: "p256dh",
    auth: "auth",
    app_slug: "warplets",
    farcaster_fid: null,
    wallet_address: null,
    ...overrides,
  };
}

describe("global statistics notification audience", () => {
  it.each([
    { name: "Farcaster-only", fids: [1129138], wallets: [], pushes: [], expected: [1, 0, 0] },
    { name: "Base-only", fids: [], wallets: ["0x1111111111111111111111111111111111111111"], pushes: [], expected: [0, 1, 0] },
    { name: "Web Push-only", fids: [], wallets: [], pushes: [webPushSubscription()], expected: [0, 0, 1] },
    {
      name: "multi-channel",
      fids: [1129138],
      wallets: ["0x1111111111111111111111111111111111111111"],
      pushes: [webPushSubscription({ farcaster_fid: 1129138 })],
      expected: [1, 1, 1],
    },
  ])("includes a $name recipient", ({ fids, wallets, pushes, expected }) => {
    const audience = buildGlobalStatsAudience({
      farcasterFids: fids,
      baseWallets: wallets,
      webPushSubscriptions: pushes,
    });
    expect([
      audience.farcasterFids.length,
      audience.baseWallets.length,
      audience.webPushSubscriptions.length,
    ]).toEqual(expected);
  });

  it("allows anonymous Chrome subscriptions for daily stats but not personal transactions", () => {
    const anonymousChrome = webPushSubscription();
    expect(isWebPushSubscriptionEligible(anonymousChrome, "daily-stats")).toBe(true);
    expect(isWebPushSubscriptionEligible(anonymousChrome, "transactional")).toBe(false);
    expect(isWebPushSubscriptionEligible(
      webPushSubscription({ wallet_address: "0x1111111111111111111111111111111111111111" }),
      "transactional",
    )).toBe(true);
  });

  it("opens the 30-day Stats Market view from every daily delivery channel", () => {
    const target = new URL(GLOBAL_STATS_TARGET_URL);
    expect(target.pathname).toBe("/stats/market");
    expect(target.searchParams.get("range")).toBe("30d");
  });
});

describe("historical activity notification suppression", () => {
  it("marks suppressed bootstrap activity as handled", () => {
    expect(activityNotificationDisposition(false, null)).toBe("suppress");
  });

  it("does not revisit activity that was already handled", () => {
    expect(activityNotificationDisposition(true, "2026-08-25T00:00:00.000Z")).toBe("already_handled");
    expect(activityNotificationDisposition(false, "2026-08-25T00:00:00.000Z")).toBe("already_handled");
  });

  it("queues new live activity by default", () => {
    expect(activityNotificationDisposition(undefined, null)).toBe("queue");
  });
});

describe("active OpenSea item offers", () => {
  it("does not resolve identities or rewrite an unchanged offer", async () => {
    let prepareCalls = 0;
    const db = {
      prepare() {
        prepareCalls += 1;
        return {
          bind() {
            return {
              async first() {
                return {
                  token_id: 1589,
                  offerer_wallet: "0x1111111111111111111111111111111111111111",
                  amount_eth: 0.001,
                  amount_raw: "1000000000000000",
                  currency_symbol: "WETH",
                  protocol_address: "0x2222222222222222222222222222222222222222",
                  active: 1,
                  created_at: "2026-08-26T00:00:00.000Z",
                  expires_at: null,
                };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    await expect(upsertActiveItemOffer(
      { WARPLETS: db },
      {
        orderHash: "0xorder",
        tokenId: 1589,
        offererWallet: "0x1111111111111111111111111111111111111111",
        amountEth: 0.001,
        amountRaw: "1000000000000000",
        currencySymbol: "WETH",
        protocolAddress: "0x2222222222222222222222222222222222222222",
        createdAt: "2026-08-26T00:00:00.000Z",
      },
    )).resolves.toBe(false);
    expect(prepareCalls).toBe(1);
  });
});
