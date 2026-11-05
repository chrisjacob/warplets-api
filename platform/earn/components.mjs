import { DAY_MS, epochAt, onboardingTenths } from '../domain/earn/index.mjs';
import { seasonActiveWeight } from '../domain/collections/policy.mjs';
import { transaction } from '../storage/database.mjs';
import { conflict, digest, name, nat, requireValue } from './checks.mjs';
import { observationAt } from '../pricing/evidence.mjs';

function preventClosed(db, epoch) {
  if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch)) conflict('board_closed','Published evidence is immutable.');
}

export function configureAction(db,{actionId,label,verifier,effectiveEpoch,enabled,atMs}) {
  name(actionId,'action ID');name(label,'action label');name(verifier,'action verifier');
  nat(effectiveEpoch,'effective board');
  requireValue(effectiveEpoch>epochAt(atMs),'Schedule catalog changes for a future UTC board.');
  requireValue(typeof enabled==='boolean','Specify whether the action is enabled.');
  return transaction(db,()=>{
    const action=db.prepare('SELECT * FROM earn_action_catalog WHERE id=?').get(actionId);
    if (action && (action.label!==label || action.verifier!==verifier)) conflict('action_conflict','Stable action ID has a different definition.');
    const prior=db.prepare('SELECT * FROM earn_action_changes WHERE action_id=? AND effective_epoch=?').get(actionId,effectiveEpoch);
    if (prior) {
      if (Boolean(prior.enabled)!==enabled) conflict('policy_conflict','A different change exists for this effective board.');
      return {actionId,effectiveEpoch,enabled};
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1').get(effectiveEpoch)) conflict('board_closed','Policy would change a finalized board.');
    if (!action) db.prepare('INSERT INTO earn_action_catalog VALUES(?,?,?)').run(actionId,label,verifier);
    db.prepare('INSERT INTO earn_action_changes VALUES(?,?,?,?)').run(actionId,effectiveEpoch,Number(enabled),atMs);
    return {actionId,effectiveEpoch,enabled};
  });
}

export function listActiveActions(db,epoch) {
  nat(epoch,'epoch');
  return db.prepare(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch
    FROM earn_action_catalog a JOIN earn_action_changes c ON c.action_id=a.id AND c.effective_epoch=(
      SELECT MAX(v.effective_epoch) FROM earn_action_changes v WHERE v.action_id=a.id AND v.effective_epoch<=?)
    WHERE c.enabled=1 ORDER BY a.id`).all(epoch);
}

export function recordActionCompletion(db,{wallet,actionId,verifier,verifiedMs,sourceRef}) {
  name(wallet,'wallet');name(actionId,'action ID');name(verifier,'verifier');name(sourceRef,'evidence');
  const epoch=epochAt(verifiedMs);
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM earn_action_completions WHERE wallet=? AND action_id=?').get(wallet,actionId);
    if (row) {
      if (row.verifier!==verifier || row.verified_ms!==verifiedMs || row.source_ref!==sourceRef) conflict('completion_exists','Action already has completion evidence.');
      return {wallet,actionId,verifiedMs};
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1').get(epoch)) conflict('board_closed','Completion must be verified prospectively.');
    const action=listActiveActions(db,epoch).find(a=>a.actionId===actionId);
    requireValue(action?.verifier===verifier,'Require the configured verifier for an active action.');
    db.prepare('INSERT INTO earn_action_completions VALUES(?,?,?,?,?)').run(wallet,actionId,verifiedMs,verifier,sourceRef);
    return {wallet,actionId,verifiedMs};
  });
}

// The local operator pins which Solana collections carry an economic Level.
export function registerCollection(db,{collectionId,kind,seasonStartMs=null}) {
  name(collectionId,'collection');
  requireValue(kind==='genesis' || kind==='season','Unknown economic collection type.');
  if (kind==='season') nat(seasonStartMs,'Season start');
  else requireValue(seasonStartMs===null,'Genesis has no expiry.');
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM earn_known_collections WHERE collection_id=?').get(collectionId);
    if (row && (row.kind!==kind || row.season_start_ms!==seasonStartMs)) conflict('collection_conflict','Collection registration differs.');
    if (!row) db.prepare('INSERT INTO earn_known_collections VALUES(?,?,?)').run(collectionId,kind,seasonStartMs);
    return {collectionId,kind,seasonStartMs};
  });
}

export function recordOwnership(db,{wallet,epoch,asOfMs,assets,sourceRef}) {
  name(wallet,'wallet');nat(epoch,'epoch');name(sourceRef,'ownership evidence');
  requireValue(asOfMs===(epoch+1)*DAY_MS-1,'Verify ownership at the board cutoff.');
  requireValue(Array.isArray(assets)&&assets.length<=1000,'Provide up to 1,000 owned asset records.');
  const ids=new Set();
  const normalized=assets.map(asset=>{
    name(asset.assetId,'asset');name(asset.collectionId,'collection');
    requireValue(asset.owner===wallet && asset.chain==='solana','Asset owner or chain does not match this wallet snapshot.');
    requireValue(Number.isInteger(asset.level)&&asset.level>=1&&asset.level<=10,'Invalid NFT Level.');
    requireValue(!ids.has(asset.assetId),'Duplicate asset in snapshot.');
    ids.add(asset.assetId);
    return {assetId:asset.assetId,collectionId:asset.collectionId,owner:wallet,chain:'solana',level:asset.level};
  }).sort((a,b)=>a.assetId<b.assetId?-1:1);
  const payload=JSON.stringify(normalized);
  return transaction(db,()=>{
    const row=db.prepare('SELECT assets,source_ref FROM earn_owner_snapshots WHERE epoch=? AND wallet=?').get(epoch,wallet);
    if (row?.assets===payload && row.source_ref===sourceRef) return {epoch,wallet};
    preventClosed(db,epoch);
    db.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?) ON CONFLICT(epoch,wallet) DO UPDATE SET assets=excluded.assets,source_ref=excluded.source_ref')
      .run(epoch,wallet,payload,sourceRef);
    db.prepare('DELETE FROM earn_owner_assets WHERE epoch=? AND wallet=?').run(epoch,wallet);
    const save=db.prepare('INSERT INTO earn_owner_assets VALUES(?,?,?)');
    for (const asset of normalized) {
      if (db.prepare('SELECT 1 FROM earn_owner_assets WHERE epoch=? AND asset_id=?').get(epoch,asset.assetId)) {
        conflict('owner_conflict','Two wallets cannot own the same NFT at the same cutoff.');
      }
      save.run(epoch,wallet,asset.assetId);
    }
    return {epoch,wallet};
  });
}

// Assemble only evidence owned by this wallet for the specified finalized cutoff.
// Absence of ownership evidence or of an active position checkpoint is pending.
export function deriveComponents(db,epoch,wallet) {
  const cutoff=(epoch+1)*DAY_MS-1;
  const owner=db.prepare('SELECT * FROM earn_owner_snapshots WHERE epoch=? AND wallet=?').get(epoch,wallet);
  if (!owner) return {status:'pending',reason:'participant-evidence'};
  const collections=new Map(db.prepare('SELECT * FROM earn_known_collections').all().map(c=>[c.collection_id,c]));
  let highestEligibleLevel=0;
  for (const asset of JSON.parse(owner.assets)) {
    const collection=collections.get(asset.collectionId);
    if (!collection) continue;
    const level=collection.kind==='genesis' ? asset.level : seasonActiveWeight(collection.season_start_ms,asset.level,cutoff);
    highestEligibleLevel=Math.max(highestEligibleLevel,level);
  }
  const positions=db.prepare(`SELECT e.token_id,c.token_days,c.source_ref,c.credited,c.flags FROM earn_position_enrollments e
    JOIN earn_fixture_campaigns m ON m.token_id=e.token_id LEFT JOIN earn_position_cutoffs c
    ON c.wallet=e.wallet AND c.token_id=e.token_id AND c.epoch=?
    WHERE e.wallet=? AND e.enrolled_ms<=? AND m.activation_ms<=? AND m.activation_ms>? ORDER BY e.token_id`)
    .all(epoch,wallet,cutoff,cutoff,cutoff-10*DAY_MS);
  if (positions.some(p=>p.token_days==null)) return {status:'pending',reason:'purchase-reconciliation'};
  for (const p of positions) {
    const valuation=observationAt(db,wallet,p.token_id,cutoff);
    if (valuation.status!=='verified' || valuation.asOfMs!==cutoff || !p.source_ref.endsWith(' / '+valuation.receipt)) {
      return {status:'pending',reason:'purchase-reconciliation'};
    }
  }
  const purchaseTokenDays=Math.min(50,positions.reduce((n,p)=>n+p.token_days,0));
  const intervals=listActiveActions(db,epoch);
  const completions=db.prepare(`SELECT action_id AS actionId,verified_ms AS verifiedAtMs,source_ref AS sourceRef
    FROM earn_action_completions WHERE wallet=? AND verified_ms<=? ORDER BY action_id`).all(wallet,cutoff);
  const payload=JSON.stringify({intervals,completions,highestEligibleLevel,purchaseTokenDays});
  return {status:'ready',payload,sourceRef:digest([owner.assets,owner.source_ref,positions,intervals,completions]),
    components:{actionTenths:onboardingTenths(epoch,intervals,completions),highestEligibleLevel,purchaseTokenDays}};
}
