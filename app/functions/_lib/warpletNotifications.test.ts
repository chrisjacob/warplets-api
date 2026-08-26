import { describe, expect, it } from "vitest";
import { activityNotificationDisposition, upsertActiveItemOffer } from "./warpletNotifications";

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
