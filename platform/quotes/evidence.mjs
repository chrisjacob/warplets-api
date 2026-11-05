import { createHash } from 'node:crypto';
import { transaction } from '../storage/database.mjs';
import {inspectLegacyQuoteCapture,evaluateQuoteData} from './verification.mjs';
import { QuoteError, requireQuote } from './math.mjs';
import { canonical } from '../transactions/canonical.mjs';

export {MAX_QUOTE_AGE_MS} from './verification.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const safeTime=n=>Number.isSafeInteger(n)&&n>=0;
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
      body=inspectLegacyQuoteCapture(JSON.parse(marketRow.body),fixture,supply.original_units,approved.og_feed,now);
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
  const quoted=evaluateQuoteData({data:JSON.parse(source.body),request:{marketId,direction,inputUnits,slippageBps},nowMs:now,
    source:{contextSlot:source.context_slot,observedMs:source.observed_ms,sourceHash:source.source_hash}});
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
