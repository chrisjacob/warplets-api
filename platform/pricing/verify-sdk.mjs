// Optional parity check using the pinned October lab installation; no RPC or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { assessObservation, normalizePolicy } from './policy.mjs';
import { sampleObservation, samplePolicy } from './fixtures.mjs';

if (!process.argv[2]) throw new Error('Supply the installed reference packages/meme-protocol directory.');
const root=resolve(process.argv[2]), req=createRequire(resolve(root,'package.json'));
const pkg=JSON.parse(readFileSync(resolve(root,'node_modules/@meteora-ag/cp-amm-sdk/package.json'),'utf8'));
assert.equal(pkg.version,'1.5.1');
const sdk=req('@meteora-ag/cp-amm-sdk'), BN=req('bn.js');
for (const [sqrt,att,og,bought,usd] of [
  [1n<<64n,9,6,5000000n,2000000n], [3n<<63n,6,9,10000000000n,2500000n], [1n<<63n,9,9,4000000000n,2000000n],
]) {
  const policy=normalizePolicy({...samplePolicy('ATT'),attDecimals:att,ogDecimals:og});
  const o=sampleObservation(policy,{wallet:'sample',asOfMs:86_400_000,stakedUnits:String(bought),ogPriceMicros:String(usd)});
  o.pool.sqrtPriceX64=o.reference.sqrtPriceX64=String(sqrt);
  o.depth.inputUnits='1000000000000';
  o.depth.grossOutputUnits=String(BigInt(o.depth.inputUnits)*sqrt*sqrt/(1n<<128n));
  const spot=sdk.getPriceFromSqrtPrice(new BN(String(sqrt)),att,og);
  const expected=spot.mul(String(bought)).mul(String(usd)).div(String(10n**BigInt(att))).floor().toFixed();
  const result=assessObservation(policy,o);
  assert.equal(result.status,'verified');assert.equal(result.microUsd,expected);
  console.log(JSON.stringify({sdk:pkg.version,attDecimals:att,ogDecimals:og,sqrtPriceX64:String(sqrt),
    sdkOgPerWholeAtt:spot.toString(),stakeMicroUsd:result.microUsd}));
}
