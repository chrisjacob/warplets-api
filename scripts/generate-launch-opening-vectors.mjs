// Offline oracle only; requires the existing ignored .tmp/meteora-oracle SDK installation.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
const require=createRequire(new URL("../.tmp/meteora-oracle/package.json",import.meta.url)),sdk=require("@meteora-ag/cp-amm-sdk"),BN=require("bn.js");
assert.equal(require("@meteora-ag/cp-amm-sdk/package.json").version,"1.5.1");
const map=JSON.parse(readFileSync(require.resolve("@meteora-ag/cp-amm-sdk")+".map","utf8"));
const hashes={
  "../src/math/poolFees/baseFee/feeTimeScheduler.ts":"7443aec6479dc38533c815fef684dc90c28e644ca30de7bc26e98e473e173944",
  "../src/math/poolFees/baseFee/feeScheduler.ts":"0c2aceb45bd1cd2d2638f3231204ae9dad0774cccbf3612d2a9ac4e16e01fc47",
  "../src/helpers/validation.ts":"4fd105575b0c92ad5bc9721d72d8ae66901f3f9b2ce2b5b34e17f46069cf692a",
  "../src/helpers/feeCodec.ts":"e23e2c1b729045d8d95363ba687be3afa4d28c58caeddd4d7f9f0dd90319ec7c",
  "../src/math/feeMath.ts":"1252cf633943a77033e0bbf8d7c5bcc4315ad5add15fc37904f0f4ede71ddbdb",
  "../src/math/swapQuote.ts":"5902ef6c94dca8325a64b13333f6ea2bbc95a1c2ff298b5ac032abd3afa78777",
};
for(const [name,hash] of Object.entries(hashes)){const i=map.sources.indexOf(name);assert(i>=0);assert.equal(createHash("sha256").update(map.sourcesContent[i]).digest("hex"),hash);}
const b=v=>new BN(v.toString()),q=1n<<64n,cases=[],schedules=[
  {cliff_fee_numerator:"500000000",number_of_periods:4,period_frequency:"60",reduction_factor:"122500000"},
  {cliff_fee_numerator:"990000000",number_of_periods:65535,period_frequency:"1",reduction_factor:"15000"},
  {cliff_fee_numerator:"200000",number_of_periods:1,period_frequency:"18446744073709551614",reduction_factor:"100000"},
];
for(const s of schedules){
  const handler=new sdk.FeeTimeScheduler(b(s.cliff_fee_numerator),s.number_of_periods,b(s.period_frequency),b(s.reduction_factor),sdk.BaseFeeMode.FeeTimeSchedulerLinear);
  assert.equal(handler.validate(sdk.CollectFeeMode.OnlyB,sdk.ActivationType.Timestamp,1),true);sdk.assertBaseFeeModeAllowedForNewPool(sdk.BaseFeeMode.FeeTimeSchedulerLinear);
  const activation=1n,frequency=BigInt(s.period_frequency),end=activation+BigInt(s.number_of_periods)*frequency;
  const points=[...new Set([0n,activation,activation+frequency-1n,activation+frequency,end-1n,end,(1n<<64n)-1n].map(String))];
  const data=Buffer.alloc(32);data.writeBigUInt64LE(BigInt(s.cliff_fee_numerator),0);data.writeUInt16LE(s.number_of_periods,14);data.writeBigUInt64LE(frequency,16);data.writeBigUInt64LE(BigInt(s.reduction_factor),24);
  const decoded=sdk.decodePodAlignedFeeTimeScheduler(data);assert.equal(decoded.numberOfPeriod,s.number_of_periods);assert.equal(decoded.periodFrequency.toString(),s.period_frequency);assert.equal(decoded.reductionFactor.toString(),s.reduction_factor);assert.equal(decoded.baseFeeMode,0);
  for(const point of points)for(const aForB of [true,false])for(const gross of [1n,1000n,1000000n,1000000000000n]){
    const lower=q/2n,current=q,upper=q*2n,liquidity=sdk.getLiquidityDeltaFromAmountAForConcentratedLiquidity(b(1000000000n),b(current),b(upper));
    const direction=aForB?sdk.TradeDirection.AtoB:sdk.TradeDirection.BtoA,mode=sdk.getFeeMode(sdk.CollectFeeMode.OnlyB,direction,true);
    const fee=handler.getBaseFeeNumeratorFromIncludedFeeAmount(b(point),b(activation),direction,b(gross),b(current),b(current));
    const poolFees={baseFee:{baseFeeInfo:{data:[...data]}},dynamicFee:{initialized:0},protocolFeePercent:20,referralFeePercent:20,compoundingFeeBps:0,initSqrtPrice:b(current)};
    const pool={collectFeeMode:sdk.CollectFeeMode.OnlyB,feeVersion:1,sqrtMinPrice:b(lower),sqrtMaxPrice:b(upper),sqrtPrice:b(current),liquidity,poolFees,activationPoint:b(activation)};
    const inputs={schedule:s,activation_point:activation.toString(),point,fee_numerator:fee.toString(),lower:lower.toString(),current:current.toString(),upper:upper.toString(),liquidity:liquidity.toString(),a_for_b:aForB,gross_input_raw:gross.toString()};
    try{const r=sdk.getSwapResultFromExactInput(pool,b(gross),mode,direction,b(point));cases.push({...inputs,status:"quoted",net_input_raw:r.excludedFeeInputAmount.toString(),trader_output_raw:r.outputAmount.toString(),next_sqrt_price:r.nextSqrtPrice.toString(),lp_claiming_fee_raw:r.claimingFee.toString(),protocol_fee_raw:r.protocolFee.toString(),referral_fee_raw:r.referralFee.toString()});}
    catch(error){assert.match(error.message,/price.*range/i);cases.push({...inputs,status:"range_exhausted"});}
  }
}
const lock=JSON.parse(readFileSync(new URL("../.tmp/meteora-oracle/package-lock.json",import.meta.url),"utf8"));
writeFileSync(new URL("../discovery/fixtures/recorded/meteora-linear-opening.json",import.meta.url),JSON.stringify({scope:"offline_linear_time_only_quote_sdk_math_not_activation_or_chain_proof",sdk_version:"1.5.1",source_commit:"79ebbfe59a225e641a2f37cd03404f26de1b0c8e",source_hashes:hashes,npm_integrity:lock.packages["node_modules/@meteora-ag/cp-amm-sdk"].integrity,cases},null,2)+"\n");
console.log(JSON.stringify({sdk_version:"1.5.1",vectors:cases.length,quoted:cases.filter(c=>c.status==="quoted").length,source_requests:0}));
