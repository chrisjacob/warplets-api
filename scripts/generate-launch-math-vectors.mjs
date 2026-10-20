// Optional developer oracle. Install only in the ignored directory:
// npm install --prefix .tmp/meteora-oracle --ignore-scripts --no-audit --no-fund @meteora-ag/cp-amm-sdk@1.5.1
// Tests consume the retained vectors and need neither this SDK nor a network.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
const require=createRequire(new URL("../.tmp/meteora-oracle/package.json",import.meta.url));
const sdk=require("@meteora-ag/cp-amm-sdk"),BN=require("bn.js");
const pkg=require("@meteora-ag/cp-amm-sdk/package.json");assert.equal(pkg.version,"1.5.1");
const sourceMap=JSON.parse(readFileSync(require.resolve("@meteora-ag/cp-amm-sdk")+".map","utf8"));
const sourceIndex=sourceMap.sources.indexOf("../src/math/liquidity/concentratedLiquidity.ts");assert.ok(sourceIndex>=0);
const sourceHash=createHash("sha256").update(sourceMap.sourcesContent[sourceIndex]).digest("hex");
assert.equal(sourceHash,"238f3b84fcc02d34b057d54fadade17a610d9e4c213840cb3dd26e8b763a3941","Published SDK math must match the pinned upstream source");
const lock=JSON.parse(readFileSync(new URL("../.tmp/meteora-oracle/package-lock.json",import.meta.url),"utf8"));
const q=1n<<64n,cases=[];
for(let i=0;i<32;i++){
  const lower=q/BigInt(i+1),current=i%2?lower:lower+q/7n,upper=current+q*BigInt(i+1),amount=1000000000n*BigInt(i+1)+BigInt(i),b=v=>new BN(v.toString());
  const liquidity=sdk.getLiquidityDeltaFromAmountAForConcentratedLiquidity(b(amount),b(current),b(upper));
  const initial=sdk.getInitialConcentratedLiquidityPoolInformation(b(lower),b(upper),b(current),liquidity);
  const directions=[];
  for(const aForB of [true,false])for(const net of [1n,1000n,1000000n,amount*1000n]){
    try{
      const result=aForB?sdk.calculateAtoBFromAmountInForConcentratedLiquidity(b(lower),b(current),liquidity,b(net)):sdk.calculateBtoAFromAmountInForConcentratedLiquidity(b(upper),b(current),liquidity,b(net));
      directions.push({a_for_b:aForB,net_input_raw:net.toString(),output_raw:result.outputAmount.toString(),next_sqrt_price:result.nextSqrtPrice.toString(),status:"quoted"});
    }catch(error){assert.match(error.message,/price.*range/i);directions.push({a_for_b:aForB,net_input_raw:net.toString(),status:"range_exhausted"});}
  }
  cases.push({lower:lower.toString(),current:current.toString(),upper:upper.toString(),amount_a_raw:amount.toString(),liquidity:liquidity.toString(),seed_a:initial.tokenAAmount.toString(),seed_b:initial.tokenBAmount.toString(),amount_a_down:sdk.getAmountAFromLiquidityDeltaForConcentratedLiquidity(b(current),b(upper),liquidity,sdk.Rounding.Down).toString(),amount_b_down:sdk.getAmountBFromLiquidityDeltaForConcentratedLiquidity(b(lower),b(current),liquidity,sdk.Rounding.Down).toString(),directions});
}
const bundle=readFileSync(require.resolve("@meteora-ag/cp-amm-sdk"));
const output={scope:"offline_sdk_math_vectors_not_chain_receipts",sdk_version:pkg.version,source_commit:"79ebbfe59a225e641a2f37cd03404f26de1b0c8e",math_source_sha256:sourceHash,npm_integrity:lock.packages["node_modules/@meteora-ag/cp-amm-sdk"].integrity,bundle_sha256:createHash("sha256").update(bundle).digest("hex"),cases};
writeFileSync(new URL("../discovery/fixtures/recorded/meteora-cl-math.json",import.meta.url),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({sdk_version:pkg.version,cases:cases.length,swap_vectors:cases.reduce((n,c)=>n+c.directions.length,0),provider_requests:0}));
