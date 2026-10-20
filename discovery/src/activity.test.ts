import { describe, expect, it } from "vitest";
import { activitySummary } from "./activity";
import { fixtureCandidates } from "./fixtures";
import { analyzeWalletEvidence } from "./wallet-analysis";
import { walletInput, now } from "./wallet-fixtures.test-helper";

async function sample() {
  const input=await walletInput(), candidate={...(await fixtureCandidates(now))[0]!,creation:input.asset.creation,graduation:input.asset.graduation,wallet_analysis:await analyzeWalletEvidence(input)};
  return {input,candidate};
}
describe("cached fee and price evidence without an organic-trading claim",()=>{
  it("counts each verified swap transaction fee once, excluding creation and failed swaps",async()=>{
    const {input,candidate}=await sample();
    const trade=input.records.find(r=>r.purposes.includes("early"))!.transaction!;
    trade.transaction.message.instructions.push(structuredClone(trade.transaction.message.instructions[0]!));
    trade.meta!.innerInstructions!.push({...structuredClone(trade.meta!.innerInstructions![0]!),index:1});
    trade.meta!.postTokenBalances[0]!.uiTokenAmount.amount="200";
    const failed=structuredClone(input.records[3]!);
    input.records=input.records.filter(r=>r.signature!==failed.signature);
    failed.transaction!.meta!.err={InstructionError:[0,"failed"]};input.records.push(failed);
    candidate.wallet_analysis=await analyzeWalletEvidence(input);
    const result=await activitySummary(candidate,input,[],now);
    expect(result.fees).toMatchObject({transactions:2,trades:3,network_fee_lamports_raw:"10000",distinct_payers:2});
    expect(result.trading_fees).toMatchObject({status:"unavailable",total_fee_raw:null,verified_trades:0,unverified_trades:3});
    expect(result.organic_trading).toBe("unverified");expect(result.volume_authenticity).toBe("unverified");
  });
  it("rejects a changed or cross-token wallet evidence root",async()=>{
    const {input,candidate}=await sample();
    await expect(activitySummary({...candidate,address:input.asset.pool},input,[],now)).rejects.toThrow("activity_wallet_evidence_mismatch");
    input.records[1]!.transaction!.meta!.fee+=1;
    await expect(activitySummary(candidate,input,[],now)).rejects.toThrow("activity_wallet_evidence_mismatch");
  });
  it("measures only comparable saved price steps and refuses to bridge missing values or source changes",async()=>{
    const {candidate}=await sample(), market=candidate.market!;
    const point=(price:number|null,n:number,source=market.source)=>({...market,price_usd:price,source,fetched_at:new Date(now.getTime()-600000+n*60000).toISOString()});
    const continuous=await activitySummary(candidate,null,[point(100,0),point(110,1),point(99,2),point(99,3)],now);
    expect(continuous.prices).toMatchObject({samples:4,upward_steps:1,downward_steps:1,unchanged_steps:1,gaps:0});expect(continuous.prices.continuous_return_pct).toBeCloseTo(-1);
    const broken=await activitySummary(candidate,null,[point(100,0),point(null,1),point(200,2),point(201,3,"dexscreener"),point(205,50)],new Date(now.getTime()+3600000));
    expect(broken.prices.continuous_return_pct).toBeNull();expect(broken.prices.upward_steps).toBe(0);expect(broken.gaps).toContain("price_history_discontinuous");
    expect(broken.fees.network_fee_lamports_raw).toBeNull();expect(broken.gaps).toContain("wallet_evidence_unavailable");
  });
  it("does not infer authenticity from flat prices, duplicate observations, zero/missing prices or future data",async()=>{
    const {candidate}=await sample(), p={...candidate.market!,price_usd:1,fetched_at:now.toISOString()};
    const result=await activitySummary(candidate,null,[p,p,{...p,price_usd:2,fetched_at:new Date(now.getTime()+60000).toISOString()}],now);
    expect(result.prices).toMatchObject({samples:1,gaps:1,continuous_return_pct:null});expect(result.organic_trading).toBe("unverified");
  });
});
