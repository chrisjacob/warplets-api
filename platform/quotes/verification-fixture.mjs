// Explicit synthetic adapter for the existing SDK fixture. This creates no
// source registration, B04 receipt, selected head or claim of chain provenance.
import {decodePoolAccount,decodeMintAccount} from './accounts.mjs';
export function createSyntheticQuoteCapture({legacy,originalUnits,manifestDigest,oraclePublicationMs=legacy.observedMs,oraclePublicationSlot=String(legacy.slot),
 accountMaxAgeMs=30000,oracleMaxAgeMs=30000,maxConfidenceBps=100,maxOracleSlotSkew=0}){
 const decoded=decodePoolAccount(legacy.pool),accountNames=['pool','attMint','ogMint','attVault','ogVault'];
 const market={id:legacy.marketId,attMint:legacy.attMint.address,ogMint:legacy.ogMint.address,poolAddress:legacy.pool.address,activationMs:decoded.activationMs};
 const policy={version:1,marketId:market.id,poolProgram:legacy.pool.owner,programBinaryDigest:null,approvedOgFeed:legacy.og.feed,
  attDecimals:decodeMintAccount(legacy.attMint).decimals,ogDecimals:decodeMintAccount(legacy.ogMint).decimals,accountMaxAgeMs,oracleMaxAgeMs,maxConfidenceBps,maxOracleSlotSkew};
 const capture={version:1,mode:'synthetic-fixture',marketId:market.id,observedMs:legacy.observedMs,contextSlot:String(legacy.slot),blockTimeMs:legacy.observedMs,retrievedAtMs:legacy.observedMs,
  finality:'finalized',investigationOpen:false,program:{address:legacy.pool.owner,binaryDigest:null},
  accounts:Object.fromEntries(accountNames.map(name=>{const a=legacy[name];return [name,{address:a.address,owner:a.owner,data:a.data,contextSlot:String(a.slot),blockTimeMs:a.observedMs,retrievedAtMs:a.observedMs}];})),
  oracle:{feed:legacy.og.feed,mint:legacy.og.mint,decimals:legacy.og.decimals,priceMicros:legacy.og.priceMicros,confidenceMicros:legacy.og.confidenceMicros,
   publicationMs:oraclePublicationMs,publicationSlot:oraclePublicationSlot,retrievedAtMs:legacy.observedMs,investigationOpen:false}};
 return {market,supply:{originalUnits,manifestDigest},policy,capture};
}
