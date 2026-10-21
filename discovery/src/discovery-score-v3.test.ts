import {describe,expect,it,vi} from "vitest";
import review from "../fixtures/score-usdf-review.json";
import xto from "../fixtures/score-xto-review.json";
import {ScoreRecordV2Schema} from "./discovery-score-v2-model";
import {ScorePriceSchema,ScoreRecordSchema} from "./discovery-score-model";
import {defaultScoreInputV2,freezeDiscoveryScoreV2} from "./discovery-score-v2";
import {defaultScoreInputV3,evaluateDiscoveryScoreV3,freezeDiscoveryScoreV3,staircaseReview} from "./discovery-score-v3";
import {FirstMarketSchema} from "./discovery-score-v3-model";
import {replayAnyDiscoveryScore} from "./discovery-score-replay";
import {assess,DEFAULT_POLICY} from "./model";

const original=ScoreRecordV2Schema.parse(review.original),at=new Date(original.inputs.as_of);
const input=()=>defaultScoreInputV3(structuredClone(original.inputs.candidate),at,ScorePriceSchema.array().parse(review.prices),false,FirstMarketSchema.parse(review.first_market));
const codes=(r:ReturnType<typeof evaluateDiscoveryScoreV3>)=>r.concerns.map(c=>c.code);
function shape(kind="stairs"){
  const v=input();let price=1;
  v.prices=Array.from({length:97},(_,i)=>{price*=kind==="volatile"?(i%2?1.03:.975):1.0006;if(kind==="stairs"&&(i===30||i===65)||kind==="one"&&i===30)price*=1.05;return {source:"dexscreener" as const,fetched_at:new Date(at.getTime()-(96-i)*300000).toISOString(),observed_at:null,price_usd:price};});return v;
}
describe("v3 launch and sampled staircase review",()=>{
  it("replays v1/v2 unchanged and demotes the real USDF inputs without a mint rule or provider calls",async()=>{
    const provider=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("No provider"));
    try{
      expect(await replayAnyDiscoveryScore(original)).toMatchObject({status:"verified"});expect(original.result.value).toBe(54);
      const v=input(),record=await freezeDiscoveryScoreV3(v);expect(record.result.value).toBe(20);expect(record.result.ceiling).toBeCloseTo(20.76,2);
      expect(record.result.launch_review.creation_purchase_observed_supply_pct).toBeCloseTo(79.336,3);
      expect(record.result.launch_review).toMatchObject({creation_purchase_raw:"793100000000000",observed_supply_raw:"999670870293877",early_reported_cap_usd:null});
      expect(record.result.staircase).toMatchObject({status:"review",samples:168,qualifying_jumps:2,return_pct:16.01,max_drawdown_pct:1.4});
      expect(record.result.staircase.jump_log_return_share).toBeGreaterThan(.6);
      expect(codes(record.result)).toContain("large_creation_purchase_relative_to_observed_supply");expect(codes(record.result)).toContain("quiet_staircase_price_rise_review");expect(codes(record.result)).not.toContain("high_early_reported_valuation");
      expect(record.result.criteria.find(c=>c.id==="sampled_performance")!.points).toBe(0);expect(await replayAnyDiscoveryScore(record)).toMatchObject({status:"verified"});
      const before=assess(v.candidate,DEFAULT_POLICY,at);v.candidate.address=v.candidate.pool;expect(evaluateDiscoveryScoreV3(v).value).toBe(20);v.candidate.address=original.inputs.candidate.address;expect(assess(v.candidate,DEFAULT_POLICY,at)).toEqual(before);
      const corrupt=structuredClone(record);corrupt.inputs.first_market!.market_cap_usd=1;await expect(replayAnyDiscoveryScore(corrupt)).rejects.toThrow("replay_mismatch");
      const old=ScoreRecordSchema.parse(xto.original);expect(await replayAnyDiscoveryScore(old)).toMatchObject({status:"verified"});const v2=await freezeDiscoveryScoreV2(defaultScoreInputV2(old.inputs.candidate,new Date(old.inputs.as_of),ScorePriceSchema.array().parse(xto.prices)));expect(v2.result.value).toBe(35);expect(await replayAnyDiscoveryScore(v2)).toMatchObject({status:"verified"});expect(provider).not.toHaveBeenCalled();
    }finally{provider.mockRestore();}
  });
  it("flags two quiet steps, but leaves ordinary trends, volatile trading and one step unflagged",()=>{
    expect(staircaseReview(shape()).status).toBe("review");for(const kind of ["trend","volatile","one"])expect(staircaseReview(shape(kind)).status,kind).toBe("not_flagged");
  });
  it.each(["limited","short","gap","source","duplicate","future","observation_after_fetch","null","zero"])("does not join an incomplete %s run into a staircase",kind=>{
    const v=shape();if(kind==="limited")v.history_limited=true;if(kind==="short")v.prices=v.prices.slice(-50);
    if(kind==="gap")v.prices.splice(40,4);if(kind==="source")v.prices[55]!.source="geckoterminal";
    if(kind==="duplicate")v.prices[55]!.fetched_at=v.prices[54]!.fetched_at.replace(".000Z","Z");
    if(kind==="future")v.prices[55]!.fetched_at=new Date(at.getTime()+1).toISOString();
    if(kind==="observation_after_fetch")v.prices[55]!.observed_at=new Date(Date.parse(v.prices[55]!.fetched_at)+1).toISOString();
    if(kind==="null")v.prices[55]!.price_usd=null;if(kind==="zero")v.prices[55]!.price_usd=0;
    expect(staircaseReview(v).status).not.toBe("review");
  });
  it("keeps extreme numeric ranges unknown",()=>{const v=shape();v.prices[29]!.price_usd=1e-300;v.prices[30]!.price_usd=1e300;expect(staircaseReview(v).gaps).toContain("staircase_numeric_range_unusable");});
  it.each(["missing","partial","zero_supply","burn","future_supply","future_wallet","unsigned","creator","signature","slot","program","time","duplicate","net_inconsistent","uncertified","creation_slot"])("leaves the historical purchase ratio unknown for %s evidence",kind=>{
    const v=input(),c=v.candidate,h=c.holders!,w=c.wallet_analysis!,buy=w.trades.find(t=>t.signature===c.creation!.signature)!;
    if(kind==="missing")c.holders=null;if(kind==="partial")h.status="partial";if(kind==="zero_supply")h.supply_raw="0";if(kind==="burn")h.supply_raw="10";
    if(kind==="future_supply")h.observed_at=new Date(at.getTime()+1).toISOString();if(kind==="future_wallet")w.observed_at=new Date(at.getTime()+1).toISOString();
    if(kind==="unsigned")w.wallets.forEach(p=>p.signed_creation=false);if(kind==="creator")h.creator=c.pool;if(kind==="signature")buy.signature=w.trades.find(t=>t.signature!==c.creation!.signature)!.signature;
    if(kind==="slot")buy.slot++;if(kind==="program")buy.program=c.pool;if(kind==="time")buy.block_time=w.observed_at;if(kind==="duplicate")w.trades.push(structuredClone(buy));
    if(kind==="net_inconsistent")w.trades.push({...buy,instruction_index:"99",net_wallet_base_raw:"1"});if(kind==="uncertified")w.gaps.push("trade_token_owner_unverified");if(kind==="creation_slot")w.creation_slot=null;
    const r=evaluateDiscoveryScoreV3(v);expect(r.launch_review.creation_purchase_observed_supply_pct).toBeNull();expect(codes(r)).not.toContain("large_creation_purchase_relative_to_observed_supply");
  });
  it("does not sum repeated transaction net balances across separate buy instructions",()=>{
    const v=input(),w=v.candidate.wallet_analysis!,buy=w.trades.find(t=>t.signature===v.candidate.creation!.signature)!;
    w.trades.push({...buy,instruction_index:"99"});expect(evaluateDiscoveryScoreV3(v).launch_review.creation_purchase_raw).toBe(buy.net_wallet_base_raw);
  });
  it("applies the continuous launch ceiling at 10/80 percent without rewarding concentration",()=>{
    const v=input(),w=v.candidate.wallet_analysis!,buy=w.trades.find(t=>t.signature===v.candidate.creation!.signature)!;v.candidate.holders!.supply_raw="1000000";v.prices=[];v.candidate.market!.liquidity_usd=1e6;
    const ceilings=[10,20,50,80,100].map(p=>{buy.base_amount_raw=buy.net_wallet_base_raw=String(p*10000);return evaluateDiscoveryScoreV3(v).ceiling;});expect(ceilings).toEqual([100,88.57,54.29,20,20]);
  });
  it.each([0,600,600.001,-1])("only treats an actually early retained cap as early (%s seconds)",seconds=>{
    const v=input();v.first_market={source:"dexscreener",fetched_at:new Date(Date.parse(v.candidate.creation!.block_time)+seconds*1000).toISOString(),observed_at:null,market_cap_usd:5e6};
    const r=evaluateDiscoveryScoreV3(v);expect(codes(r).includes("high_early_reported_valuation")).toBe(seconds>=0&&seconds<=600);
  });
  it("never substitutes FDV, late quotes or future observations for early cap",()=>{
    const v=input();expect(evaluateDiscoveryScoreV3(v).launch_review.first_quote_delay_seconds).toBeGreaterThan(14*3600);
    v.first_market!.fetched_at=v.candidate.creation!.block_time;v.first_market!.market_cap_usd=null;v.candidate.market!.fdv_usd=1e12;expect(codes(evaluateDiscoveryScoreV3(v))).not.toContain("high_early_reported_valuation");
    v.first_market!.market_cap_usd=5e6;v.first_market!.observed_at=at.toISOString();expect(codes(evaluateDiscoveryScoreV3(v))).not.toContain("high_early_reported_valuation");
    v.first_market!.observed_at=new Date(Date.parse(v.candidate.creation!.block_time)-1).toISOString();expect(codes(evaluateDiscoveryScoreV3(v))).not.toContain("high_early_reported_valuation");
    v.first_market!.observed_at=null;v.candidate.creation!.fetched_at=new Date(Date.parse(v.candidate.creation!.block_time)-1).toISOString();expect(codes(evaluateDiscoveryScoreV3(v))).not.toContain("high_early_reported_valuation");expect(evaluateDiscoveryScoreV3(v).launch_review.creation_purchase_raw).toBeNull();
  });
});
