import {describe,expect,it,vi} from "vitest";
import review from "../fixtures/score-xto-review.json";
import {ScorePriceSchema,ScoreRecordSchema} from "./discovery-score-model";
import {defaultScoreInput,evaluateDiscoveryScore} from "./discovery-score";
import {defaultScoreInputV2,evaluateDiscoveryScoreV2,freezeDiscoveryScoreV2,replayAnyDiscoveryScore} from "./discovery-score-v2";
import type {ScoreInputV2} from "./discovery-score-v2-model";

const original=ScoreRecordSchema.parse(review.original),at=new Date(original.inputs.as_of);
function clean():ScoreInputV2 {
  const c=structuredClone(original.inputs.candidate);c.market!.market_cap_usd=1_000_000;c.market!.liquidity_usd=100_000;
  c.wallet_analysis!.trades=c.wallet_analysis!.trades.map(t=>({...t,quote_amount_raw:"20000000"}));
  const prices=Array.from({length:7},(_,i)=>({source:"dexscreener" as const,fetched_at:new Date(at.getTime()-(6-i)*300000).toISOString(),observed_at:null,price_usd:1+i*.01}));
  return defaultScoreInputV2(c,at,prices);
}
const codes=(r:ReturnType<typeof evaluateDiscoveryScoreV2>)=>r.concerns.map(c=>c.code);
describe("discovery-score-v2 market integrity",()=>{
  it("replays the retained first-ranked v1 artifact unchanged and demotes the observed XTO pattern without an address rule",async()=>{
    const provider=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("provider forbidden"));
    try {
      expect((await replayAnyDiscoveryScore(original)).status).toBe("verified");expect(original.result.value).toBe(86);
      const input=defaultScoreInputV2(original.inputs.candidate,at,ScorePriceSchema.array().parse(review.prices)),record=await freezeDiscoveryScoreV2(input);
      expect(record.result.value).toBe(35);expect(record.result.ceiling).toBe(35.1);
      expect(codes(record.result)).toEqual(["abrupt_sampled_price_move","thin_reported_depth_relative_to_cap","dust_dominated_post_creation_trade_sample"]);
      expect(record.result.integrity).toMatchObject({largest_jump_pct:124.9,sampled_trades:7,dust_trades:7,sampled_wallets:5,qualifying_buyers:0});
      expect((await replayAnyDiscoveryScore(record)).status).toBe("verified");
      const renamed=structuredClone(input);renamed.candidate.address=original.inputs.candidate.pool;
      expect(evaluateDiscoveryScoreV2(renamed).value).toBe(35);expect(provider).not.toHaveBeenCalled();
      const tampered=structuredClone(record);tampered.result.integrity.dust_trades=0;await expect(replayAnyDiscoveryScore(tampered)).rejects.toThrow("replay_mismatch");
    }finally{provider.mockRestore();}
  });
  it("leaves ordinary volatile prices with meaningful sampled trades uncapped",()=>{
    const input=clean();input.prices.forEach((p,i)=>p.price_usd=[1,1.1,.97,1.15,1.03,1.1,1.2][i]!);
    const result=evaluateDiscoveryScoreV2(input);expect(codes(result)).toEqual([]);expect(result.ceiling).toBe(100);expect(result.integrity.qualifying_buyers).toBe(5);
    expect(result.criteria.find(c=>c.id==="sampled_performance")!.points).toBeGreaterThan(0);
    const v1=evaluateDiscoveryScore(defaultScoreInput(input.candidate,at,input.prices));expect(result.value).toBe(v1.value);
  });
  it.each([[2,40],[.5,40],[1.99,100],[.501,100]])("handles the exact jump boundary %s",(ratio,ceiling)=>{
    const input=clean();input.prices=input.prices.slice(-2);input.prices[1]!.price_usd=input.prices[0]!.price_usd!*ratio;
    expect(evaluateDiscoveryScoreV2(input).ceiling).toBe(ceiling);
  });
  it.each(["mixed","gap","future","unknown","duplicate_instant","outside"])("never compares across a %s boundary",kind=>{
    const input=clean();input.prices=input.prices.slice(-2);input.prices[1]!.price_usd=100;
    if(kind==="mixed")input.prices[1]!.source="geckoterminal";
    if(kind==="gap")input.prices[0]!.fetched_at=new Date(at.getTime()-600001).toISOString();
    if(kind==="future")input.prices[1]!.observed_at=new Date(at.getTime()+1).toISOString();
    if(kind==="unknown")input.prices[0]!.price_usd=null;
    if(kind==="duplicate_instant")input.prices[1]!.fetched_at=input.prices[0]!.fetched_at.replace(".000Z","Z");
    if(kind==="outside")input.prices[0]!.fetched_at=new Date(at.getTime()-86400001).toISOString();
    expect(codes(evaluateDiscoveryScoreV2(input))).not.toContain("abrupt_sampled_price_move");
  });
  it("retains a dated jump outside the momentum window and despite truncated history",()=>{
    const input=clean();input.history_limited=true;input.prices=[{...input.prices[0]!,fetched_at:new Date(at.getTime()-4*3600000).toISOString(),price_usd:1},{...input.prices[1]!,fetched_at:new Date(at.getTime()-4*3600000+600000).toISOString(),price_usd:2},...input.prices];
    expect(codes(evaluateDiscoveryScoreV2(input))).toContain("abrupt_sampled_price_move");expect(evaluateDiscoveryScoreV2(input).integrity.gaps).toContain("price_history_sample_limited");
  });
  it("applies continuous relative depth ceilings without substituting FDV or future reports",()=>{
    const input=clean(),values=[0,1000,5000,12500,50000,100000].map(liquidity=>{input.candidate.market!.liquidity_usd=liquidity;return evaluateDiscoveryScoreV2(input).value;});
    expect(values).toEqual([...values].sort((a,b)=>a-b));input.candidate.market!.market_cap_usd=null;input.candidate.market!.fdv_usd=1e12;
    expect(codes(evaluateDiscoveryScoreV2(input))).not.toContain("thin_reported_depth_relative_to_cap");input.candidate.market!.market_cap_usd=1e12;input.candidate.market!.observed_at=new Date(at.getTime()+1).toISOString();
    expect(evaluateDiscoveryScoreV2(input).integrity.liquidity_cap_ratio).toBeNull();
  });
  it("counts only material later buys, excluding the large initial creation buy",()=>{
    const input=clean();input.candidate.wallet_analysis!.trades=structuredClone(original.inputs.candidate.wallet_analysis!.trades);
    const result=evaluateDiscoveryScoreV2(input);expect(result.integrity.qualifying_buyers).toBe(0);expect(codes(result)).toContain("dust_dominated_post_creation_trade_sample");
    expect(result.criteria.find(x=>x.id==="sampled_buyers")!.points).toBe(0);expect(result.criteria.find(x=>x.id==="sampled_performance")!.points).toBe(0);
  });
  it.each(["short","one_wallet","unknown","duplicate","future"])("does not turn a %s trade sample into a dust finding",kind=>{
    const input=clean(),w=input.candidate.wallet_analysis!;w.trades=structuredClone(original.inputs.candidate.wallet_analysis!.trades);
    if(kind==="short")w.trades=w.trades.slice(0,5);
    if(kind==="one_wallet")w.trades.forEach(t=>t.wallet=w.trades[0]!.wallet);
    if(kind==="unknown")w.trades.forEach(t=>t.quote_amount_raw=null);
    if(kind==="duplicate")w.trades=w.trades.slice(0,3).flatMap(t=>[t,t,t]);
    if(kind==="future")w.observed_at=new Date(at.getTime()+1).toISOString();
    expect(codes(evaluateDiscoveryScoreV2(input))).not.toContain("dust_dominated_post_creation_trade_sample");
  });
  it("sums known buys per wallet at the participation threshold",()=>{
    const input=clean(),w=input.candidate.wallet_analysis!;w.trades=w.trades.filter(t=>t.wallet===w.trades[1]!.wallet);w.trades.forEach(t=>t.quote_amount_raw="5000000");
    expect(evaluateDiscoveryScoreV2(input).integrity.qualifying_buyers).toBe(1);w.trades[0]!.quote_amount_raw="4999999";expect(evaluateDiscoveryScoreV2(input).integrity.qualifying_buyers).toBe(0);
  });
});
