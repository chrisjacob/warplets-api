import { describe, expect, it, vi } from "vitest";
import { historyGranularity, mergeStonkletHistoryPoints, persistStonkletHistory } from "./stonkletHistory";

describe("Stonklet retained history", () => {
  it("selects retained granularity for each chart range", () => {
    expect(historyGranularity("1h")).toBe("5m");
    expect(historyGranularity("24h")).toBe("5m");
    expect(historyGranularity("7d")).toBe("1h");
    expect(historyGranularity("90d")).toBe("1h");
    expect(historyGranularity("all")).toBe("1d");
  });

  it("merges duplicate timestamps with the latest group taking precedence", () => {
    expect(mergeStonkletHistoryPoints(
      [{ time: 200, price: 2 }, { time: 100, price: 1 }],
      [{ time: 200, price: 2.5 }, { time: 300, price: 3 }],
    )).toEqual([{ time: 100, price: 1 }, { time: 200, price: 2.5 }, { time: 300, price: 3 }]);
  });

  it("upserts all rollups and cleans only the finite retention tiers", async () => {
    const bound: unknown[][] = [];
    const prepare = vi.fn((sql: string) => ({
      bind: (...values: unknown[]) => {
        bound.push([sql, ...values]);
        return { sql, values };
      },
    }));
    const batch = vi.fn(async () => []);
    const db = { prepare, batch } as unknown as D1Database;
    await persistStonkletHistory(db, [{ pairId: "robinhood", price: 12.5, marketCap: 1_000, updatedAt: "2026-09-02T12:07:00.000Z" }], new Date("2026-09-02T13:00:00.000Z"));

    expect(batch).toHaveBeenCalledOnce();
    expect(bound.filter(([sql]) => String(sql).includes("INSERT INTO"))).toHaveLength(3);
    expect(bound.some(([, pairId, granularity, bucket]) => pairId === "robinhood" && granularity === "5m" && bucket === "2026-09-02T12:05:00.000Z")).toBe(true);
    expect(bound.filter(([sql]) => String(sql).includes("DELETE FROM"))).toHaveLength(2);
    expect(bound.some(([sql]) => String(sql).includes("granularity = '1d'"))).toBe(false);
  });
});
