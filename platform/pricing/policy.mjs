import { decimal, name, nat, requireValue } from '../earn/checks.mjs';

export const DAMM_V2_PROGRAM='cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
const Q128=1n<<128n;
const BPS=10_000n;
// Inclusive bounds in @meteora-ag/cp-amm-sdk 1.5.1 (pinned protocol lab).
const MIN_SQRT=4295048016n, MAX_SQRT=79226673521066979257578248091n;
function checkedInt(value,min,max,label) {
  requireValue(Number.isSafeInteger(value)&&value>=min&&value<=max,`Invalid ${label}.`);
  return value;
}
export function normalizePolicy(p) {
  requireValue(p && typeof p==='object','A price policy is required.');
  const policy={};
  for (const key of ['tokenId','pool','attMint','ogMint','farm','farmProgram','ogFeed','network']) policy[key]=name(p[key],key);
  requireValue(policy.network==='local-solana' && policy.attMint!==policy.ogMint,'Select a local ATT/OG fixture pair.');
  policy.poolProgram=DAMM_V2_PROGRAM;
  for (const key of ['attDecimals','ogDecimals']) policy[key]=checkedInt(p[key],0,18,key);
  policy.maxAgeMs=checkedInt(p.maxAgeMs,1,300_000,'fixture freshness');
  policy.maxSlotSkew=checkedInt(p.maxSlotSkew,0,1000,'slot skew');
  policy.maxConfidenceBps=checkedInt(p.maxConfidenceBps,0,1000,'oracle confidence');
  policy.maxMoveBps=checkedInt(p.maxMoveBps,1,10_000,'reference movement');
  policy.maxDepthImpactBps=checkedInt(p.maxDepthImpactBps,1,5000,'depth impact');
  policy.minLookbackMs=checkedInt(p.minLookbackMs,1000,86_400_000,'minimum lookback');
  policy.maxLookbackMs=checkedInt(p.maxLookbackMs,policy.minLookbackMs,7*86_400_000,'maximum lookback');
  policy.minProbeUsdMicros=String(decimal(p.minProbeUsdMicros,'probe USD'));
  requireValue(BigInt(policy.minProbeUsdMicros)>0n,'Positive measured probe depth required.');
  return policy;
}
function gcd(a,b) { while (b) [a,b]=[b,a%b]; return a; }
const difference=(a,b)=>a>b?a-b:b-a;
function amount(record,key,maximum=(1n<<128n)-1n) {
  const n=decimal(record[key],key);
  requireValue(n<=maximum,`${key} exceeds its raw representation.`);
  return n;
}
const pending=reason=>({status:'pending',reason});

// The DAMM-v2 sqrt price is raw B per raw A in Q64.64; the square is Q128.
// OG quote is in micro-USD per whole OG token. Using raw ATT units here means
// ATT decimals cancel from the valuation (but must still match registration).
export function assessObservation(p,{wallet,tokenId,asOfMs,pool,og,farm,reference,depth,validUntilMs=null}) {
  nat(asOfMs,'checkpoint');name(wallet,'wallet');name(tokenId,'token');
  if (tokenId!==p.tokenId) return pending('token-mismatch');
  if (!pool || !og || !farm || !reference || !depth) return pending('missing-observation');
  if (validUntilMs!=null && (!Number.isSafeInteger(validUntilMs)||validUntilMs<asOfMs)) return pending('expired-observation');
  if ([pool,og,farm,reference,depth].some(r=>r.network!==p.network || r.finalized!==true || !r.sourceRef)) {
    return pending('unverified-provenance');
  }
  if (pool.address!==p.pool || pool.program!==p.poolProgram || pool.mintA!==p.attMint || pool.mintB!==p.ogMint
      || pool.decimalsA!==p.attDecimals || pool.decimalsB!==p.ogDecimals
      || og.feed!==p.ogFeed || og.mint!==p.ogMint || og.decimals!==p.ogDecimals
      || farm.address!==p.farm || farm.program!==p.farmProgram || farm.owner!==wallet || farm.mint!==p.attMint
      || reference.address!==p.pool || reference.program!==p.poolProgram
      || depth.address!==p.pool || depth.inputMint!==p.attMint || depth.outputMint!==p.ogMint) {
    return pending('source-mismatch');
  }
  const samples=[pool,og,farm,depth];
  for (const sample of [...samples,reference]) {
    if (!Number.isSafeInteger(sample.observedMs) || !Number.isSafeInteger(sample.slot) || sample.slot<0 || sample.observedMs<0) {
      return pending('invalid-checkpoint');
    }
  }
  if (samples.some(s=>s.observedMs>asOfMs || asOfMs-s.observedMs>p.maxAgeMs)) return pending('stale-or-future');
  if (Math.max(...samples.map(s=>s.slot))-Math.min(...samples.map(s=>s.slot))>p.maxSlotSkew || depth.slot!==pool.slot) {
    return pending('slot-skew');
  }
  const refAge=pool.observedMs-reference.observedMs;
  if (reference.slot>=pool.slot || refAge<p.minLookbackMs || refAge>p.maxLookbackMs) return pending('missing-lookback');
  if (pool.investigationOpen!==false || og.investigationOpen!==false) return pending('price-investigation');
  const sqrt=amount(pool,'sqrtPriceX64'), baseline=amount(reference,'sqrtPriceX64');
  const usd=amount(og,'priceMicros'),spread=amount(og,'confidenceMicros');
  const stake=amount(farm,'stakedUnits',(1n<<64n)-1n);
  const probeIn=amount(depth,'inputUnits',(1n<<64n)-1n), probeOut=amount(depth,'grossOutputUnits',(1n<<64n)-1n);
  if (sqrt<MIN_SQRT||sqrt>MAX_SQRT||baseline<MIN_SQRT||baseline>MAX_SQRT) return pending('pool-price-out-of-range');
  if (usd===0n||spread*BPS>usd*BigInt(p.maxConfidenceBps)) return pending('price-confidence');
  const square=sqrt*sqrt, prior=baseline*baseline;
  if (difference(square,prior)*BPS>prior*BigInt(p.maxMoveBps)) return pending('rapid-price-movement');
  const numerator=square*usd, denominator=Q128*10n**BigInt(p.ogDecimals);
  if (probeIn===0n || probeOut===0n || probeIn*numerator<BigInt(p.minProbeUsdMicros)*denominator) {
    return pending('insufficient-quoted-depth');
  }
  // The probe is a fee-excluded executable ATT-to-OG quote for the same pool/slot.
  // Both overly optimistic and deeply discounted quotes hold settlement.
  if (difference(probeOut*Q128,probeIn*square)*BPS>probeIn*square*BigInt(p.maxDepthImpactBps)) return pending('excessive-depth-impact');
  const factor=gcd(numerator,denominator);
  return {status:'verified',microUsd:String(stake*numerator/denominator),stakedUnits:String(stake),
    priceNumerator:String(numerator/factor),priceDenominator:String(denominator/factor),
    expiresMs:Math.min(validUntilMs??Number.MAX_SAFE_INTEGER,...samples.map(s=>s.observedMs+p.maxAgeMs))};
}
