import { readFileSync } from 'node:fs';
import { importMarket } from '../markets/catalog.mjs';
import { recordVaultManifest } from '../vault/ledger.mjs';
import { importQuoteEvidence,registerQuoteSource } from './evidence.mjs';
const vector=JSON.parse(readFileSync(new URL('./fixtures/sdk-vectors.json',import.meta.url)));

/** Synthetic, pinned-SDK fixture for tests and explicit local demonstrations. */
export function quoteFixture(now,marketId='quote-demo'){
  const activationMs=Math.floor(now/1000)*1000-90_000;
  const pool=structuredClone(vector.pool);
  const bytes=Buffer.from(pool.data,'base64');
  bytes.writeBigUInt64LE(BigInt(activationMs/1000),472);pool.data=bytes.toString('base64');
  const tagged=(account,name)=>({...account,slot:12345,observedMs:now,finalized:true,sourceRef:'sdk-fixture:'+name});
  return {id:marketId+':'+now,marketId,observedMs:now,slot:12345,finalized:true,network:'solana-local',investigationOpen:false,
    pool:tagged(pool,'pool'),attMint:tagged(vector.attMint,'att-mint'),ogMint:tagged(vector.ogMint,'og-mint'),
    attVault:tagged(vector.attVault,'att-vault'),ogVault:tagged(vector.ogVault,'og-vault'),
    og:tagged({feed:'fixture-og-usd',mint:vector.ogMint.address,decimals:6,priceMicros:vector.ogPriceMicros,
      confidenceMicros:'0',investigationOpen:false},'og-usd')};
}
export function seedQuoteFixture(db,now,marketId='quote-demo'){
  const fixture=quoteFixture(now,marketId);
  const activationMs=Number(Buffer.from(fixture.pool.data,'base64').readBigUInt64LE(472))*1000;
  importMarket(db,{id:marketId,symbol:'QUOTEATT',ogSymbol:'QUOTEOG',attMint:fixture.attMint.address,
    ogMint:fixture.ogMint.address,poolAddress:fixture.pool.address,activatedAt:new Date(activationMs).toISOString()});
  recordVaultManifest(db,{marketId,originalUnits:vector.originalSupplyUnits});
  registerQuoteSource(db,{marketId,ogFeed:'fixture-og-usd',sourceRef:'sdk-1.5.1-local-vector'});
  importQuoteEvidence(db,fixture,now);
  return fixture;
}
