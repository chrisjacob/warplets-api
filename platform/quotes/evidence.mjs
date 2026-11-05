import { createHash } from 'node:crypto';
import { transaction } from '../storage/database.mjs';
import { decodePoolAccount, decodeMintAccount, decodeVaultAccount } from './accounts.mjs';
import { QuoteError, requireQuote, units, quoteAmounts, quoteValuation,validateQuotePool } from './math.mjs';
import { canonical } from '../transactions/canonical.mjs';

export const MAX_QUOTE_AGE_MS=30_000;
const hash=text=>createHash('sha256').update(text).digest('hex');
const safeTime=n=>Number.isSafeInteger(n)&&n>=0;
function inspect(market,fixture,originalSupply,approvedFeed,now){
  const {pool,attMint,ogMint,attVault,ogVault,og}=fixture;
  requireQuote(fixture.network==='solana-local' && fixture.finalized===true && fixture.investigationOpen===false,
    'unverified_capture','A finalized local account capture and investigation status are required.');
  requireQuote(safeTime(fixture.observedMs)&&fixture.observedMs<=now && Number.isSafeInteger(fixture.slot)&&fixture.slot>0,
    'invalid_checkpoint','Invalid observation clock or slot.');
  requireQuote(pool?.address===market.poolAddress && attMint?.address===market.attMint && ogMint?.address===market.ogMint,
    'identity_mismatch','Account identities differ from the registered market.');
  for(const account of [pool,attMint,ogMint,attVault,ogVault,og]){
    requireQuote(account?.slot===fixture.slot && account.observedMs===fixture.observedMs && account.finalized===true
      && typeof account.sourceRef==='string' && account.sourceRef.length>0 && account.sourceRef.length<=256,
      'mixed_checkpoint','All observations must match the finalized slot and timestamp.');
  }
  const decoded=decodePoolAccount(pool),att=decodeMintAccount(attMint),original=decodeMintAccount(ogMint);
  validateQuotePool(decoded);
  const aVault=decodeVaultAccount(attVault),bVault=decodeVaultAccount(ogVault);
  requireQuote(decoded.attMint===market.attMint && decoded.ogMint===market.ogMint && decoded.attVault===attVault.address
    && decoded.ogVault===ogVault.address && aVault.mint===market.attMint && bVault.mint===market.ogMint,
    'vault_mismatch','Vault or mint wiring differs from the pool bytes.');
  requireQuote(decoded.activationMs===Date.parse(market.activatedAt),'activation_mismatch','Pool and registered activation differ.');
  requireQuote(units(att.supplyUnits,'current supply')<=units(originalSupply,'original supply') && units(originalSupply,'original supply')>0n,
    'supply_mismatch','Current ATT supply exceeds the immutable original supply.');
  requireQuote(og.mint===market.ogMint && og.decimals===original.decimals && typeof og.feed==='string'
    && og.feed===approvedFeed && og.investigationOpen===false,
    'oracle_mismatch','OG observation differs from the approved local feed.');
  const price=units(og.priceMicros,'OG price',(1n<<128n)-1n),confidence=units(og.confidenceMicros,'confidence',(1n<<128n)-1n);
  requireQuote(price>0n&&confidence*10_000n<=price*100n,'oracle_confidence','OG price confidence exceeds the 1% quote-pilot limit.');
  return {pool:{...decoded,attDecimals:att.decimals,ogDecimals:original.decimals},
    attVaultUnits:aVault.amountUnits,ogVaultUnits:bVault.amountUnits,ogUsdMicros:price.toString(),originalSupplyUnits:originalSupply,
    expiresMs:fixture.observedMs+MAX_QUOTE_AGE_MS};
}

export function registerQuoteSource(db,{marketId,ogFeed,sourceRef}){
  requireQuote([marketId,ogFeed,sourceRef].every(s=>typeof s==='string' && s.trim()===s && s.length>0 && s.length<=256),
    'invalid_source','Specify the market, approved OG feed and source reference.',400);
  return transaction(db,()=>{
    requireQuote(db.prepare('SELECT 1 FROM market_fixtures WHERE id=?').get(marketId),'market_missing','Import the market first.',409);
    const prior=db.prepare('SELECT * FROM quote_sources WHERE market_id=?').get(marketId);
    if(prior)requireQuote(prior.og_feed===ogFeed&&prior.source_ref===sourceRef,'source_conflict','The quote source policy is immutable.',409);
    else db.prepare('INSERT INTO quote_sources VALUES(?,?,?)').run(marketId,ogFeed,sourceRef);
    return {marketId,ogFeed,replayed:Boolean(prior)};
  });
}

/** Structural verification of a local capture. Oracle authenticity and raw RPC
 * finality remain adapter gates; returned quotes clearly identify fixture data.
 * A newer incomplete checkpoint masks prior evidence, even if still young.
 */
export function importQuoteEvidence(db,fixture,now=Date.now()){
  requireQuote(fixture && typeof fixture==='object' && /^[A-Za-z0-9._:-]{1,128}$/.test(fixture.id??'')
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(fixture.marketId??''),'invalid_capture','Provide capture and market IDs.',400);
  requireQuote(safeTime(fixture.observedMs)&&fixture.observedMs<=now && Number.isSafeInteger(fixture.slot)&&fixture.slot>0,
    'invalid_checkpoint','Capture timestamp and slot must be known and finalized.',400);
  const raw=canonical(fixture);
  requireQuote(Buffer.byteLength(raw)<=32_768,'capture_size','Capture exceeds 32 KiB.',400);
  return transaction(db,()=>{
    const marketRow=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(fixture.marketId);
    const supply=db.prepare('SELECT original_units FROM vault_manifests WHERE id=?').get(fixture.marketId);
    const approved=db.prepare('SELECT og_feed FROM quote_sources WHERE market_id=?').get(fixture.marketId);
    requireQuote(marketRow&&supply&&approved,'manifest_missing','Register the market, immutable allocation manifest and OG feed before quoting.',409);
    const old=db.prepare('SELECT * FROM quote_pool_snapshots WHERE id=? OR (market_id=? AND observed_ms=?)')
      .get(fixture.id,fixture.marketId,fixture.observedMs);
    const digest=hash(raw);
    if(old){
      requireQuote(old.id===fixture.id&&old.source_hash===digest,'capture_conflict','A finalized checkpoint already exists.',409);
      return {id:old.id,status:old.status,reason:old.reason,replayed:true};
    }
    let body,status='verified',reason=null;
    try{
      const priorSlot=db.prepare('SELECT MAX(context_slot) AS slot FROM quote_pool_snapshots WHERE market_id=?').get(fixture.marketId).slot;
      requireQuote(priorSlot===null || fixture.slot>=priorSlot,'slot_regression','The finalized checkpoint moved backward.');
      body=inspect(JSON.parse(marketRow.body),fixture,supply.original_units,approved.og_feed,now);
    }
    catch(error){if(!(error instanceof QuoteError))throw error;status='pending';reason=error.code;body={};}
    db.prepare('INSERT INTO quote_pool_snapshots VALUES(?,?,?,?,?,?,?,?)')
      .run(fixture.id,fixture.marketId,fixture.observedMs,fixture.slot,status,reason,JSON.stringify(body),digest);
    return {id:fixture.id,status,reason,replayed:false};
  });
}

export function quoteExactInput(db,{marketId,direction,inputUnits,slippageBps},now=Date.now()){
  const source=db.prepare('SELECT * FROM quote_pool_snapshots WHERE market_id=? AND observed_ms<=? ORDER BY observed_ms DESC LIMIT 1')
    .get(marketId,now);
  requireQuote(source,'evidence_unavailable','A finalized pool and OG price capture is required.',503);
  requireQuote(source.status==='verified','evidence_pending','The latest quote evidence is incomplete: '+source.reason+'.',503);
  const data=JSON.parse(source.body),pool=data.pool;
  requireQuote(now<data.expiresMs,'stale_quote_source','The pool and OG price capture has expired.',503);
  const result=quoteAmounts({direction,inputUnits,slippageBps,pool,nowMs:now});
  const buy=direction==='buy-att',available=units(buy?data.attVaultUnits:data.ogVaultUnits,'vault balance');
  requireQuote(BigInt(result.grossOutputUnits)<=available,'insufficient_vault','The output vault cannot cover this quote.');
  const decayEnd=pool.activationMs+89_000;
  const feeBoundary=now<decayEnd?pool.activationMs+(Math.floor((now-pool.activationMs)/1000)+1)*1000:Number.MAX_SAFE_INTEGER;
  const expiresMs=Math.min(data.expiresMs,now+15_000,feeBoundary);
  requireQuote(expiresMs>now,'quote_expired','The quote expired. Refresh its evidence.',503);
  const quoted={version:1,marketId,direction,inputMint:buy?pool.ogMint:pool.attMint,outputMint:buy?pool.attMint:pool.ogMint,
    inputDecimals:buy?pool.ogDecimals:pool.attDecimals,outputDecimals:buy?pool.attDecimals:pool.ogDecimals,
    ...result,slippageBps,quotedAt:new Date(now).toISOString(),expiresAt:new Date(expiresMs).toISOString(),
    contextSlot:source.context_slot,observedAt:new Date(source.observed_ms).toISOString(),sourceHash:source.source_hash,
    ...quoteValuation({pool,ogUsdMicros:data.ogUsdMicros,supplyUnits:data.originalSupplyUnits,inputUnits,
      expectedOutputUnits:result.expectedOutputUnits,direction}),
    fees:{asset:pool.ogMint,side:buy?'input':'output',networkLamports:null,accountRentLamports:null},
    source:'local-fixture',route:'meteora-damm-v2',executable:false};
  return {id:hash(canonical(quoted)),...quoted};
}

export function quoteAvailability(db,marketId,now=Date.now()){
  const row=db.prepare('SELECT status,reason,observed_ms,body FROM quote_pool_snapshots WHERE market_id=? AND observed_ms<=? ORDER BY observed_ms DESC LIMIT 1').get(marketId,now);
  if(row?.status==='verified' && JSON.parse(row.body).pool.activationMs>now){
    return {available:false,reason:'preactivation',source:'local-fixture',executable:false};
  }
  return row?.status==='verified'&&JSON.parse(row.body).expiresMs>now
    ?{available:true,expiresAt:new Date(JSON.parse(row.body).expiresMs).toISOString(),
      attDecimals:JSON.parse(row.body).pool.attDecimals,ogDecimals:JSON.parse(row.body).pool.ogDecimals,
      source:'local-fixture',executable:false}
    :{available:false,reason:row?.status==='pending'?row.reason:row?'expired':'missing',source:'local-fixture',executable:false};
}
