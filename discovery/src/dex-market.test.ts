import { describe, expect, it, vi } from "vitest";
import { dexMarkets } from "./dex-market";
import { syntheticBundle } from "./fixtures";
import { WSOL } from "./pump";
describe("free batch market source", () => {
  it("retains explicit reported cap, separate FDV, safe image and source identity", async () => {
    const b = await syntheticBundle(), reserve = vi.fn(), transport = vi.fn(async()=>Response.json([{chainId:"solana",pairAddress:b.pool,baseToken:{address:b.mint},quoteToken:{address:WSOL},priceUsd:".001",marketCap:100000,fdv:200000,liquidity:{usd:50000},volume:{h24:10000},info:{imageUrl:"https://cdn.dexscreener.com/token.png"}}]));
    const result = await dexMarkets([{address:b.mint,pool:b.pool}],reserve,"2026-10-20T00:00:00Z",transport);
    expect(result.get(b.mint)).toMatchObject({source:"dexscreener",market_cap_usd:100000,fdv_usd:200000,observed_at:null});expect(reserve).toHaveBeenCalledExactlyOnceWith("market");expect(transport).toHaveBeenCalledOnce();
  });
  it("never substitutes FDV, another pool, another chain or another quote asset",async()=>{
    const b=await syntheticBundle(),row={address:b.mint,pool:b.pool},base={chainId:"solana",pairAddress:b.pool,baseToken:{address:b.mint},quoteToken:{address:WSOL},fdv:200000};
    const run=(p:unknown)=>dexMarkets([row],async()=>{},"2026-10-20T00:00:00Z",async()=>Response.json([p]));
    expect((await run(base)).get(b.mint)?.market_cap_usd).toBeNull();
    expect(await run({...base,chainId:"other"})).toEqual(new Map());
    expect(await run({...base,pairAddress:b.mint})).toEqual(new Map());
    await expect(run({...base,quoteToken:{address:b.mint}})).rejects.toThrow("market_identity_mismatch");
    await expect(run({...base,baseToken:{address:WSOL}})).rejects.toThrow("market_identity_mismatch");
  });
  it("reserves before requests, honors errors and rejects overlarge batches",async()=>{
    const b=await syntheticBundle(), rows=[{address:b.mint,pool:b.pool}], transport=vi.fn();
    await expect(dexMarkets(rows,async()=>{throw Error("market_daily_budget_exhausted")},"2026-10-20T00:00:00Z",transport)).rejects.toThrow("market_daily_budget_exhausted");expect(transport).not.toHaveBeenCalled();
    await expect(dexMarkets(rows,async()=>{},"2026-10-20T00:00:00Z",async()=>new Response(null,{status:429}))).rejects.toThrow("market_rate_limited");
    await expect(dexMarkets(Array(31).fill(rows[0]),async()=>{},"2026-10-20T00:00:00Z",transport)).rejects.toThrow("invalid_market_batch");
  });
});
