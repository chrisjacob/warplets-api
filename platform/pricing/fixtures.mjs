import { DAMM_V2_PROGRAM } from './policy.mjs';
import { importPriceObservation, registerPriceSource } from './evidence.mjs';

// Deterministic local input for tests and interactive demos. Names deliberately
// cannot be confused with chain addresses. These are not balances from a provider.
export function samplePolicy(tokenId) {
  return {tokenId,attMint:'fixture-mint:'+tokenId,ogMint:'fixture-og',pool:'fixture-pool:'+tokenId,
    farm:'fixture-farm:'+tokenId,farmProgram:'fixture-farm-program',ogFeed:'fixture-feed',network:'local-solana',
    attDecimals:0,ogDecimals:0,maxAgeMs:300000,maxSlotSkew:4,maxConfidenceBps:100,maxMoveBps:2000,
    maxDepthImpactBps:1000,minLookbackMs:1000,maxLookbackMs:60000,minProbeUsdMicros:'10000000'};
}
export function sampleObservation(policy,{wallet,asOfMs,stakedUnits,ogPriceMicros='1',sourceRef='sample'}) {
  const common={network:policy.network,finalized:true,slot:100,observedMs:asOfMs,sourceRef};
  const sqrtPriceX64=String(1n<<64n);
  return {wallet,tokenId:policy.tokenId,asOfMs,
    pool:{...common,address:policy.pool,program:DAMM_V2_PROGRAM,mintA:policy.attMint,mintB:policy.ogMint,
      decimalsA:policy.attDecimals,decimalsB:policy.ogDecimals,sqrtPriceX64,investigationOpen:false},
    og:{...common,feed:policy.ogFeed,mint:policy.ogMint,decimals:policy.ogDecimals,
      priceMicros:ogPriceMicros,confidenceMicros:'0',investigationOpen:false},
    farm:{...common,address:policy.farm,program:policy.farmProgram,mint:policy.attMint,owner:wallet,stakedUnits},
    reference:{...common,address:policy.pool,program:DAMM_V2_PROGRAM,slot:99,
      observedMs:asOfMs-policy.minLookbackMs,sqrtPriceX64},
    depth:{...common,address:policy.pool,inputMint:policy.attMint,outputMint:policy.ogMint,
      inputUnits:'10000000',grossOutputUnits:'10000000'}};
}
export function recordSamplePrice(db,{wallet,tokenId,asOfMs,stakedUnits,ogPriceMicros,sourceRef,validUntilMs=null}) {
  const policy=samplePolicy(tokenId);
  registerPriceSource(db,policy);
  return importPriceObservation(db,{...sampleObservation(policy,{wallet,asOfMs,stakedUnits,ogPriceMicros,sourceRef}),validUntilMs});
}
