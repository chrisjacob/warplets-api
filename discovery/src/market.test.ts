import { describe, expect, it, vi } from "vitest";
import { marketForPool } from "./market";
import { syntheticBundle } from "./fixtures";

describe("market enrichment is separate from chain evidence", () => {
  it("preserves unknown market cap despite an available FDV", async () => {
    const b = await syntheticBundle(), reserve = vi.fn();
    const market = await marketForPool(b.pool, b.mint, reserve, "2026-10-20T00:00:00Z", async () => Response.json({ data: { attributes: { address: b.pool, base_token_price_usd: "0.001", market_cap_usd: null, fdv_usd: "1000000", reserve_in_usd: "30000", volume_usd: { h24: "2000" } }, relationships: { base_token: { data: { id: `solana_${b.mint}` } } } } }));
    expect(market.market_cap_usd).toBeNull(); expect(market.fdv_usd).toBe(1_000_000); expect(market.observed_at).toBeNull(); expect(reserve).toHaveBeenCalledWith("market");
  });
  it("rejects mismatched market identity and respects rate-limit failures", async () => {
    const b = await syntheticBundle();
    await expect(marketForPool(b.pool, b.mint, async () => {}, "2026-10-20T00:00:00Z", async () => Response.json({ data: { attributes: { address: b.mint, volume_usd: {} }, relationships: { base_token: { data: { id: "wrong" } } } } }))).rejects.toThrow();
    await expect(marketForPool(b.pool, b.mint, async () => {}, "2026-10-20T00:00:00Z", async () => new Response("limited", { status: 429 }))).rejects.toThrow("market_rate_limited");
  });
});
