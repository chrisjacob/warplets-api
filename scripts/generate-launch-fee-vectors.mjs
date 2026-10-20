// Optional pinned SDK oracle in ignored .tmp/meteora-oracle; see generate-launch-math-vectors.mjs.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
const require=createRequire(new URL("../.tmp/meteora-oracle/package.json",import.meta.url)),sdk=require("@meteora-ag/cp-amm-sdk"),BN=require("bn.js");
assert.equal(require("@meteora-ag/cp-amm-sdk/package.json").version,"1.5.1");
const map=JSON.parse(readFileSync(require.resolve("@meteora-ag/cp-amm-sdk")+".map","utf8"));
const hashes={"../src/math/feeMath.ts":"1252cf633943a77033e0bbf8d7c5bcc4315ad5add15fc37904f0f4ede71ddbdb","../src/math/swapQuote.ts":"5902ef6c94dca8325a64b13333f6ea2bbc95a1c2ff298b5ac032abd3afa78777","../src/math/liquidity/concentratedLiquidity.ts":"238f3b84fcc02d34b057d54fadade17a610d9e4c213840cb3dd26e8b763a3941"};
for(const [name,hash] of Object.entries(hashes)){const i=map.sources.indexOf(name);assert.ok(i>=0);assert.equal(createHash("sha256").update(map.sourcesContent[i]).digest("hex"),hash);}
const q=1n<<64n,b=v=>new BN(v.toString()),cases=[];
for(const lowerStart of [false,true])for(const fee of [100000n,2500000n,10000000n,500000000n,990000000n])for(const config of [{protocol:0,referral:0,hasReferral:false},{protocol:20,referral:20,hasReferral:true},{protocol:100,referral:100,hasReferral:true}])for(const aForB of [true,false])for(const gross of [1n,1000n,1000000n,1000000000000n]){
  const lower=q/2n,current=lowerStart?lower:q,upper=q*2n,liquidity=sdk.getLiquidityDeltaFromAmountAForConcentratedLiquidity(b(1000000000n),b(current),b(upper));
  const data=Buffer.alloc(32);data.writeBigUInt64LE(fee,0); // mode 0, zero periods/frequency/reduction => static time scheduler.
  const poolFees={baseFee:{baseFeeInfo:{data:[...data]}},dynamicFee:{initialized:0},protocolFeePercent:config.protocol,referralFeePercent:config.referral,compoundingFeeBps:0,initSqrtPrice:b(current)};
  const pool={collectFeeMode:sdk.CollectFeeMode.OnlyB,feeVersion:1,sqrtMinPrice:b(lower),sqrtMaxPrice:b(upper),sqrtPrice:b(current),liquidity,poolFees,activationPoint:b(0)};
  const direction=aForB?sdk.TradeDirection.AtoB:sdk.TradeDirection.BtoA,mode=sdk.getFeeMode(sdk.CollectFeeMode.OnlyB,direction,config.hasReferral);
  const inputs={lower:lower.toString(),current:current.toString(),upper:upper.toString(),liquidity:liquidity.toString(),fee_numerator:fee.toString(),protocol_percent:config.protocol,referral_percent:config.referral,has_referral:config.hasReferral,a_for_b:aForB,gross_input_raw:gross.toString()};
  try{const r=sdk.getSwapResultFromExactInput(pool,b(gross),mode,direction,b(10));cases.push({...inputs,status:"quoted",fees_on_input:mode.feesOnInput,net_input_raw:r.excludedFeeInputAmount.toString(),trader_output_raw:r.outputAmount.toString(),next_sqrt_price:r.nextSqrtPrice.toString(),lp_claiming_fee_raw:r.claimingFee.toString(),protocol_fee_raw:r.protocolFee.toString(),referral_fee_raw:r.referralFee.toString(),compounding_fee_raw:r.compoundingFee.toString()});}
  catch(error){assert.match(error.message,/price.*range/i);cases.push({...inputs,status:"range_exhausted"});}
}
const lock=JSON.parse(readFileSync(new URL("../.tmp/meteora-oracle/package-lock.json",import.meta.url),"utf8"));
writeFileSync(new URL("../discovery/fixtures/recorded/meteora-onlyb-fees.json",import.meta.url),JSON.stringify({scope:"offline_static_only_quote_sdk_quotes_not_chain_receipts",sdk_version:"1.5.1",source_commit:"79ebbfe59a225e641a2f37cd03404f26de1b0c8e",source_hashes:hashes,npm_integrity:lock.packages["node_modules/@meteora-ag/cp-amm-sdk"].integrity,cases},null,2)+"\n");
console.log(JSON.stringify({sdk_version:"1.5.1",exact_input_vectors:cases.length,quoted:cases.filter(c=>c.status==="quoted").length,provider_requests:0}));
