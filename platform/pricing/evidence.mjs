import { createHash } from 'node:crypto';
import { transaction } from '../storage/database.mjs';
import { conflict, name, nat, requireValue } from '../earn/checks.mjs';
import { assessObservation, normalizePolicy } from './policy.mjs';
import { epochAt } from '../domain/earn/index.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const encode=value=>JSON.stringify(canonical(value));
const hash=s=>createHash('sha256').update(s).digest('hex');

export function registerPriceSource(db,input) {
  const policy=normalizePolicy(input);
  const payload=encode(policy), policyHash=hash(payload);
  return transaction(db,()=>{
    const old=db.prepare('SELECT * FROM price_sources WHERE token_id=?').get(policy.tokenId);
    if (old && old.policy_hash!==policyHash) conflict('source_pinned','This campaign has a different pinned pool or price policy.');
    requireValue(db.prepare('SELECT 1 FROM earn_fixture_campaigns WHERE token_id=?').get(policy.tokenId),'Register the local campaign first.');
    if (!old) db.prepare('INSERT INTO price_sources VALUES(?,?,?)').run(policy.tokenId,payload,policyHash);
    return {tokenId:policy.tokenId,policyHash};
  });
}

// Both verified and pending observations are retained. A newer suspicious sample
// masks the last good price. A revised pending sample names its predecessor.
export function importPriceObservation(db,input) {
  const {wallet,tokenId,asOfMs,pool,og,farm,reference,depth,supersedes=null,validUntilMs=null}=input;
  name(wallet,'wallet');name(tokenId,'token');nat(asOfMs,'checkpoint');
  const raw=encode({wallet,tokenId,asOfMs,pool:pool??null,og:og??null,farm:farm??null,reference:reference??null,depth:depth??null,validUntilMs});
  requireValue(Buffer.byteLength(raw)<=24*1024,'Price observation exceeds local fixture bounds.');
  return transaction(db,()=>{
    const source=db.prepare('SELECT * FROM price_sources WHERE token_id=?').get(tokenId);
    requireValue(source,'Register a corresponding market price source.');
    const receipt=hash(encode([source.policy_hash,supersedes,raw]));
    const same=db.prepare('SELECT decision FROM price_observations WHERE receipt=?').get(receipt);
    if (same) return {receipt,...JSON.parse(same.decision)};
    const closed=db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epochAt(asOfMs));
    if (closed) conflict('board_closed','Price evidence for the closed board is sealed.');
    const old=db.prepare('SELECT * FROM price_observations WHERE token_id=? AND wallet=? AND as_of_ms=? ORDER BY revision DESC LIMIT 1').get(tokenId,wallet,asOfMs);
    if ((old?.receipt??null)!==supersedes) conflict('revision_conflict','Name the latest receipt for this checkpoint.');
    if (old?.read_id) conflict('verified_checkpoint','Verified evidence is immutable. Record a later observation.');
    let decision;
    try {decision=assessObservation(JSON.parse(source.policy),JSON.parse(raw));}
    catch(error) {
      if (error?.code!=='invalid_input') throw error;
      decision={status:'pending',reason:'malformed-evidence'};
    }
    const readId=decision.status==='verified'?receipt:null;
    if (readId) {
      db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)')
        .run(readId,wallet,tokenId,asOfMs,decision.expiresMs,decision.microUsd,'price:'+receipt);
    }
    db.prepare('INSERT INTO price_observations VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(receipt,tokenId,wallet,asOfMs,(old?.revision??0)+1,supersedes,source.policy_hash,raw,JSON.stringify(decision),readId);
    return {receipt,...decision};
  });
}

export function observationAt(db,wallet,tokenId,time) {
  const row=db.prepare(`SELECT receipt,decision,read_id,as_of_ms FROM price_observations
    WHERE wallet=? AND token_id=? AND as_of_ms<=? ORDER BY as_of_ms DESC,revision DESC LIMIT 1`).get(wallet,tokenId,time);
  if (!row) return {status:'pending',reason:'missing-observation'};
  const decision=JSON.parse(row.decision);
  if (decision.status==='verified' && decision.expiresMs<time) return {status:'pending',reason:'stale-or-future',receipt:row.receipt};
  return {...decision,receipt:row.receipt,readId:row.read_id,asOfMs:row.as_of_ms};
}

export function verifiedStakeAt(db,wallet,tokenId,time) {
  const obs=observationAt(db,wallet,tokenId,time);
  return obs.status==='verified' ? db.prepare('SELECT * FROM earn_stake_reads WHERE id=?').get(obs.readId) : null;
}
