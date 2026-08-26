import { describe, expect, it } from "vitest";
import {
  deriveOpenSeaMarketBootstrapState,
  getTokenIdFromOpenSeaRow,
  isOpenSeaMarketIngestDue,
  markOpenSeaMarketIngestSuccessIfLeaseOwned,
  marketPatchChangesCurrent,
  ownsOpenSeaMarketLease,
  processKeyedRowsWithConcurrency,
  resolveOpenSeaMarketNotificationMode,
} from "./openseaMarket";

describe("OpenSea token attribution", () => {
  it("prefers the NFT identifier over an unrelated root identifier", () => {
    expect(
      getTokenIdFromOpenSeaRow({
        identifier: "1358",
        nft: { identifier: "1589" },
      }),
    ).toBe(1589);
  });

  it("uses the root identifier when no structured NFT identifier exists", () => {
    expect(getTokenIdFromOpenSeaRow({ identifier: "1358" })).toBe(1358);
  });
});

describe("OpenSea bootstrap notifications", () => {
  it("suppresses notifications until bootstrap completion is persisted", () => {
    expect(resolveOpenSeaMarketNotificationMode(false, {})).toBe("suppress");
    expect(resolveOpenSeaMarketNotificationMode(true, { bootstrap: true })).toBe("suppress");
  });

  it("queues fresh events after bootstrap unless explicitly suppressed", () => {
    expect(resolveOpenSeaMarketNotificationMode(true, {})).toBe("queue");
    expect(resolveOpenSeaMarketNotificationMode(true, { notificationMode: "suppress" })).toBe("suppress");
  });
});

describe("OpenSea bootstrap cursors", () => {
  it("is incomplete while any event stream has a pending cursor", () => {
    const state = deriveOpenSeaMarketBootstrapState([
      { key: "events_after:sale", value: "1780000000" },
      { key: "events_after:transfer", value: "1780000000" },
      { key: "events_cursor:transfer", value: "next-page" },
      { key: "events_after:listing", value: "1780000000" },
      { key: "events_after:offer", value: "1780000000" },
    ]);
    expect(state.complete).toBe(false);
    expect(state.pendingEventTypes).toEqual(["transfer"]);
  });

  it("completes only after all four after-cursors exist and page cursors are cleared", () => {
    const state = deriveOpenSeaMarketBootstrapState(
      ["sale", "transfer", "listing", "offer"].map((eventType) => ({
        key: `events_after:${eventType}`,
        value: "1780000000",
      })),
    );
    expect(state.complete).toBe(true);
    expect(state.pendingEventTypes).toEqual([]);
  });
});

describe("scheduled OpenSea freshness", () => {
  const now = Date.parse("2026-08-25T00:10:00.000Z");

  it("runs when no valid success timestamp exists", () => {
    expect(isOpenSeaMarketIngestDue(null, now, 10)).toBe(true);
    expect(isOpenSeaMarketIngestDue("not-a-date", now, 10)).toBe(true);
  });

  it("waits for the full freshness interval", () => {
    expect(isOpenSeaMarketIngestDue("2026-08-25T00:00:01.000Z", now, 10)).toBe(false);
    expect(isOpenSeaMarketIngestDue("2026-08-25T00:00:00.000Z", now, 10)).toBe(true);
  });
});

describe("OpenSea ingest lease", () => {
  it("allows only the Worker that persisted the lease owner to ingest", () => {
    expect(ownsOpenSeaMarketLease("worker-a", "worker-a")).toBe(true);
    expect(ownsOpenSeaMarketLease("worker-b", "worker-a")).toBe(false);
    expect(ownsOpenSeaMarketLease(null, "worker-a")).toBe(false);
  });

  function completionDb(persistedOwner: string | null) {
    const writes = new Map<string, string>();
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: string[]) {
            return {
              async run() {
                const [key, value, , leaseKey, requestedOwner] = values;
                const isFencedCompletion = sql.includes("FROM opensea_ingest_state AS lease") &&
                  leaseKey === "market_ingest:lease";
                const accepted = isFencedCompletion && persistedOwner === requestedOwner;
                if (accepted) writes.set(key, value);
                return { meta: { changes: accepted ? 1 : 0 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    return { db, writes };
  }

  it("records scheduled success only while the same Worker owns the lease", async () => {
    const { db, writes } = completionDb("worker-a");
    const completedAt = "2026-08-26T01:15:00.000Z";

    await expect(
      markOpenSeaMarketIngestSuccessIfLeaseOwned(db, "worker-a", completedAt),
    ).resolves.toBe(true);
    expect(writes.get("market_ingest:last_success_at")).toBe(completedAt);
  });

  it("rejects stale completion after another Worker owns the lease", async () => {
    const { db, writes } = completionDb("worker-b");

    await expect(
      markOpenSeaMarketIngestSuccessIfLeaseOwned(
        db,
        "worker-a",
        "2026-08-26T01:15:00.000Z",
      ),
    ).resolves.toBe(false);
    expect(writes.has("market_ingest:last_success_at")).toBe(false);
  });
});

describe("OpenSea scan write suppression", () => {
  it("does not rewrite an unchanged row merely to refresh its scan timestamp", () => {
    expect(marketPatchChangesCurrent(
      {
        token_id: 1589,
        listing_order_hash: "0xorder",
        listing_raw_amount: "1000000000000000",
        opensea_updated_at: "2026-08-26T00:00:00.000Z",
      },
      {
        token_id: 1589,
        listing_order_hash: "0xorder",
        listing_raw_amount: "1000000000000000",
        opensea_updated_at: "2026-08-26T00:10:00.000Z",
      },
    )).toBe(false);
  });

  it("still writes a real order or price change", () => {
    expect(marketPatchChangesCurrent(
      { token_id: 1589, listing_order_hash: "0xold" },
      { token_id: 1589, listing_order_hash: "0xnew" },
    )).toBe(true);
  });
});

describe("OpenSea bounded row processing", () => {
  it("runs independent tokens concurrently while preserving order per token", async () => {
    const rows = [
      { token: "a", sequence: 1 },
      { token: "a", sequence: 2 },
      { token: "b", sequence: 1 },
      { token: "b", sequence: 2 },
    ];
    const processed = new Map<string, number[]>();
    let active = 0;
    let maxActive = 0;

    const changed = await processKeyedRowsWithConcurrency(
      rows,
      (row) => row.token,
      async (row) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const tokenRows = processed.get(row.token) ?? [];
        tokenRows.push(row.sequence);
        processed.set(row.token, tokenRows);
        active -= 1;
        return true;
      },
      2,
    );

    expect(changed).toBe(4);
    expect(maxActive).toBe(2);
    expect(processed.get("a")).toEqual([1, 2]);
    expect(processed.get("b")).toEqual([1, 2]);
  });
});
