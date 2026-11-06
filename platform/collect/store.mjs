import {stageEligibility,stageReservationStatus,expirySchedule,inventoryDisclosure} from './projections.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../storage/database.mjs';
import { decode58 } from '../server/base58.mjs';
import { snapshotSeasonFreeWallets, checkTimestamp, LEVEL_QUOTAS, seasonExpiry } from '../domain/collections/policy.mjs';
import { admitMint, applyVerifiedMintDraw, createInventory, freezeFreeStage, inventoryCounts, publishStage } from '../domain/collections/inventory.mjs';
import { prepareProgression, applyVerifiedProgressionDraw, visualRerollQuote } from '../domain/collections/progression.mjs';
import { observeAsset } from '../vault/ledger.mjs';
import { bindDraw,requireBoundResult } from '../randomness/selection.mjs';
import { actionDecision } from '../operations/controls.mjs';

export class CollectError extends Error {
  constructor(status,code,message) { super(message); this.status=status; this.code=code; }
}
export function need(condition,code,message,status=400) {
  if(!condition) throw new CollectError(status,code,message);
}
export function id(value) {
  need(typeof value==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value),'invalid_id','Invalid local identifier.');
  return value;
}
function address(value) {
  try { decode58(value,32); } catch { throw new CollectError(400,'invalid_wallet','Invalid Solana wallet address.'); }
  return value;
}
const u64=(value)=>{
  need(typeof value==='string' && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value)<(1n<<64n),
    'invalid_units','Expected a canonical unsigned lamport amount.');
  return BigInt(value);
};
const encode=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?{$lamports:v.toString()}:v);
const decode=value=>JSON.parse(value,(_k,v)=>v && typeof v==='object' && Object.hasOwn(v,'$lamports')?u64(v.$lamports):v);
const hash=value=>createHash('sha256').update(encode(value)).digest('hex');
const iso=ms=>new Date(ms).toISOString();
export const jsonValue=value=>JSON.parse(JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v));
const inventory=(db,invId)=>{
  const row=db.prepare('SELECT * FROM collect_inventories WHERE id=?').get(id(invId));
  need(row,'collection_not_found','Unknown collection inventory.',404);
  return row;
};
function saveInventory(db,row,state) {
  const changed=db.prepare('UPDATE collect_inventories SET state=?,revision=? WHERE id=? AND revision=?')
    .run(encode(state),state.version,row.id,row.revision);
  need(changed.changes===1,'revision_conflict','Collection state changed. Refresh and retry.',409);
}
export function createCollection(db,fixture) {
  const collectionId=id(fixture.id), kind=fixture.kind;
  const state=createInventory({id:collectionId,kind,tranche:fixture.tranche});
  const start=kind==='season'?checkTimestamp(fixture.seasonStart):null;
  need(kind!=='season'||fixture.tranche==null,'invalid_tranche','Season inventories have no Genesis tranche number.');
  const month=start==null?null:iso(start).slice(0,7);
  const digest=hash([collectionId,kind,fixture.tranche??null,start]);
  return transaction(db,()=>{
    const prior=db.prepare('SELECT origin_digest FROM collect_inventories WHERE id=?').get(collectionId);
    if(prior) {
      need(prior.origin_digest===digest,'collection_conflict','Collection identity is immutable.',409);
      return {id:collectionId,replayed:true};
    }
    if(kind==='season') {
      const frozen=db.prepare('SELECT 1 FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id WHERE v.activated_ms>=? AND v.activated_ms<? LIMIT 1')
        .get(start,seasonExpiry(start,10));
      need(!frozen,'historical_snapshot_conflict','A registered launch already froze its Season weights in this period.',409);
    }
    if(kind==='season') need(!db.prepare('SELECT 1 FROM collect_inventories WHERE season_month=?').get(month),
      'duplicate_month','A Season already exists for this UTC month.',409);
    if(kind==='genesis') need(!db.prepare('SELECT 1 FROM collect_inventories WHERE tranche=?').get(fixture.tranche),
      'duplicate_tranche','A Genesis inventory already exists for this tranche number.',409);
    db.prepare('INSERT INTO collect_inventories VALUES(?,?,?,?,?,?,?,?)')
      .run(collectionId,kind,fixture.tranche??null,start,month,0,encode(state),digest);
    return {id:collectionId,replayed:false};
  });
}

export function publishCollectionStage(db,fixture,now=Date.now()) {
  const {inventoryId,stage}=fixture;
  id(stage.id);
  need(checkTimestamp(stage.publishedAt)<=now,'future_publication','Stage publication is in the future.');
  const {priceLamports,costLamports,approvedSpendLamports,wallets=[],...terms}=stage;
  need(Array.isArray(wallets) && wallets.length<=10000,'list_too_large','Maximum 10,000 whitelist entries.');
  const input={...terms,priceLamports:u64(priceLamports),wallets:wallets.map(address),
    approvedSpendLamports:approvedSpendLamports==null?undefined:u64(approvedSpendLamports)};
  const costs=u64(costLamports);
  const ballotId=stage.ballotId==null?null:id(stage.ballotId);
  const inventoryOverrideReason=stage.inventoryOverrideReason??null;
  need(inventoryOverrideReason===null || (typeof inventoryOverrideReason==='string'
    && inventoryOverrideReason.trim().length>0 && inventoryOverrideReason.length<=500),'invalid_override','Provide a short founder rationale.');
  const digest=hash([id(inventoryId),input.id,input.type,input.publishedAt,input.opensAt,input.closesAt,input.priceLamports,
    costs,input.allocation,input.walletLimit??null,input.founderApproved??false,input.approvedSpendLamports??null,
    ballotId,inventoryOverrideReason,[...new Set(input.wallets)].sort()]);
  return transaction(db,()=>{
    const row=inventory(db,inventoryId),state=decode(row.state);
    const prior=state.stages.find(s=>s.id===input.id);
    if(prior) {
      need(prior.termsDigest===digest,'stage_conflict','Published stage terms are immutable.',409);
      return {stageId:input.id,replayed:true};
    }
    need(state.stages.length<32,'stage_limit','Local pilot is limited to 32 stages per inventory.',409);
    need(row.kind!=='season' || input.opensAt>=row.season_start,'stage_before_season','Stage opens before Season start.');
    if(row.kind==='genesis' && row.tranche>1 && !state.stages.length) {
      need(ballotId,'missing_ballot','The first stage of the next tranche must reference its published ballot.');
      const prev=db.prepare('SELECT state FROM collect_inventories WHERE tranche=?').get(row.tranche-1);
      const ballot=db.prepare('SELECT tranche_open_ms FROM genesis_ballots WHERE id=?').get(ballotId);
      need(prev && ballot,'missing_previous_tranche','Publish the previous tranche and its ballot first.',409);
      const openings=decode(prev.state).stages.map(s=>s.opensAt);
      need(openings.length && ballot.tranche_open_ms===Math.min(...openings),'wrong_ballot','Ballot must identify the prior tranche opening.',409);
    }
    // The public API checks this immutable published quote, including buyer-paid
    // creation costs or founder-paid costs. Client-supplied prices are rejected.
    const next=publishStage(state,input);
    saveInventory(db,row,{...next,stages:next.stages.map(s=>s.id===input.id?{...s,costLamports:costs,termsDigest:digest,
      ballotId,inventoryOverrideReason}:s)});
    return {stageId:input.id,replayed:false};
  });
}

/** Operator separately supplies a complete, finalized, immutable ownership+reveal
 * cut from the snapshot boundary. Production verification of its provenance is
 * intentionally outside this local importer.
 */
export function freezeSeasonSnapshot(db,fixture,now=Date.now()) {
  const {inventoryId,stageId,sourceRef,at,holdings}=fixture;
  id(sourceRef);id(stageId);
  need(fixture.finalized===true && checkTimestamp(at)<=now,'snapshot_not_final','A finalized local snapshot is required.');
  need(Array.isArray(holdings) && holdings.length<=10000,'invalid_holdings','Snapshot must contain at most 10,000 holdings.');
  const canonical=holdings.map(nft=>({id:id(nft.id),owner:address(nft.owner),collection:id(nft.collection),
    level:nft.level??null,revealedAt:nft.revealedAt??null})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const snap=snapshotSeasonFreeWallets({at,holdings:canonical});
  const digest=hash([inventoryId,stageId,at,sourceRef,canonical]);
  return transaction(db,()=>{
    const row=inventory(db,inventoryId);
    const prior=db.prepare('SELECT snapshot_hash FROM collect_snapshots WHERE inventory_id=? AND stage_id=?').get(inventoryId,stageId);
    if(prior) {
      need(prior.snapshot_hash===digest,'snapshot_conflict','A different snapshot already exists.',409);
      return {digest,replayed:true};
    }
    // A finalized source may add historical Genesis NFTs not in our pilot. It
    // cannot omit or contradict known ownership/Level evidence at the same cut.
    const indexed=new Map(canonical.map(nft=>[nft.id,nft]));
    const tracked=db.prepare(`SELECT a.id,a.reveal_ms,a.asset FROM collect_assets a JOIN collect_inventories i
      ON i.id=a.inventory_id WHERE i.kind='genesis' AND a.bind_ms<=?`).all(at);
    const ownerAt=db.prepare(`SELECT body FROM vault_observations WHERE asset_id=? AND observed_ms<=?
      AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1`);
    for(const known of tracked) {
      const nft=indexed.get(known.id),observed=ownerAt.get(known.id,at);
      const owner=observed && JSON.parse(observed.body);
      const revealed=known.reveal_ms!==null && known.reveal_ms<=at;
      need(nft?.collection==='solana-genesis' && owner && nft.owner===(owner.to??owner.owner)
        && (!revealed?nft.revealedAt===null || nft.revealedAt>at:
          nft.revealedAt===known.reveal_ms && nft.level===decode(known.asset).level),
        'conflicting_ownership_cut','Snapshot conflicts with a known Genesis holding.',409);
    }
    for(const nft of canonical) {
      if(nft.collection!=='solana-genesis') continue;
      const known=db.prepare('SELECT i.kind,a.bind_ms FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE a.id=?').get(nft.id);
      need(!known || (known.kind==='genesis' && known.bind_ms<=at),'conflicting_ownership_cut','A supplied NFT cannot establish Genesis ownership.',409);
    }
    const next=freezeFreeStage(decode(row.state),stageId,snap);
    saveInventory(db,row,next);
    db.prepare('INSERT INTO collect_snapshots VALUES(?,?,?,?,?,?)')
      .run(randomUUID(),inventoryId,stageId,at,sourceRef,digest);
    return {digest,eligibleWallets:snap.wallets.length,replayed:false};
  });
}

function checkRetry(db,owner,requestKey,digest) {
  id(requestKey);
  const old=db.prepare('SELECT * FROM collect_operations WHERE owner=? AND request_key=?').get(address(owner),requestKey);
  if(old) need(old.request_digest===digest,'idempotency_conflict','This key identifies a different operation.',409);
  return old;
}
function insertOperation(db,{opId,kind,inventoryId,owner,requestKey,digest,commitment,now,operation}) {
  db.prepare('INSERT INTO collect_operations(id,kind,inventory_id,owner,request_key,request_digest,commitment,created_ms,operation) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(opId,kind,inventoryId,owner,requestKey,digest,commitment,now,encode(operation));
  bindDraw(db,{opId,kind,inventoryId,owner,commitment,now});
}
const opFor=(db,opId)=>db.prepare('SELECT * FROM collect_operations WHERE id=?').get(id(opId));
function opView(row) {
  const op=decode(row.operation);
  return jsonValue({id:row.id,kind:row.kind,inventoryId:row.inventory_id,owner:row.owner,
    stageId:op.stageId??null,targetId:op.targetId??null,materialId:op.materialId??null,
    status:row.settled_ms===null?'awaiting-evidence':'fulfilled',createdAt:null,
    priceLamports:op.priceLamports??null,costLamports:op.costLamports??null,feeLamports:op.feeLamports??null,
    assetId:row.receipt?decode(row.receipt).assetId??null:null,source:'local-fixture',executable:false});
}
export function reserveMint(db,{inventoryId,stageId,wallet,requestKey,expectedTermsDigest,now=Date.now()}) {
  const digest=hash(['mint',id(inventoryId),id(stageId)]);
  return transaction(db,()=>{
    const prior=checkRetry(db,wallet,requestKey,digest);
    if(expectedTermsDigest!==undefined){
      need(typeof expectedTermsDigest==='string'&&/^[a-f0-9]{64}$/.test(expectedTermsDigest),'invalid_input','Supply the reviewed published terms digest.');
      const terms=db.prepare("SELECT json_extract(s.value,'$.termsDigest') digest FROM collect_inventories h JOIN json_each(h.state,'$.stages') s WHERE h.id=? AND json_extract(s.value,'$.id')=? LIMIT 2").all(inventoryId,stageId);
      need(terms.length===1&&terms[0].digest===expectedTermsDigest,'mint-command-binding','The reviewed stage terms do not match.',409);
    }
    const reviewed=result=>expectedTermsDigest===undefined?result:{...result,operation:{...result.operation,termsDigest:expectedTermsDigest}};
    if(prior) return reviewed({operation:opView(prior),replayed:true});
    const row=inventory(db,inventoryId),state=decode(row.state);
    const stage=state.stages.find(s=>s.id===stageId);
    need(stage,'stage_not_found','Unknown mint stage.',404);
    need(stage.type!=='founder','operator_only','Founder inventory requires an operator reservation.',403);
    return reviewed(createReservation(db,row,state,stage,wallet,requestKey,digest,now));
  });
}
export function reserveFounderMint(db,{inventoryId,stageId,wallet,requestKey,now=Date.now()}) {
  const digest=hash(['founder',id(inventoryId),id(stageId)]);
  return transaction(db,()=>{
    const prior=checkRetry(db,wallet,requestKey,digest);
    if(prior) return {operation:opView(prior),replayed:true};
    const row=inventory(db,inventoryId),state=decode(row.state),stage=state.stages.find(s=>s.id===stageId);
    need(stage?.type==='founder','not_founder_stage','Expected an explicitly funded founder stage.');
    return createReservation(db,row,state,stage,wallet,requestKey,digest,now);
  });
}
function createReservation(db,row,state,stage,wallet,requestKey,digest,now) {
  const control=actionDecision(db,'collection-mint',now);
  need(control.allowed,'scope_unavailable','New mint reservations are held: '+control.reason,503);
  const hold=trancheOpeningHold(db,row,state,now);
  need(!hold,'tranche_postponed',hold??'',409);
  const opId=randomUUID(),commitment=randomUUID();
  const next=admitMint(state,{operationId:opId,wallet,stageId:stage.id,drawCommitment:commitment,
    at:checkTimestamp(now),costLamports:stage.costLamports});
  saveInventory(db,row,next);
  insertOperation(db,{opId,kind:'mint',inventoryId:row.id,owner:wallet,requestKey,digest,commitment,now,
    operation:{stageId:stage.id,costLamports:stage.costLamports,priceLamports:stage.priceLamports}});
  return {operation:opView(opFor(db,opId)),replayed:false};
}

function trancheOpeningHold(db,row,state,now) {
  if(row.kind!=='genesis' || row.tranche===1 || state.admissions.length>0 || !state.stages.length) return null;
  const first=state.stages[0];
  const decision=db.prepare('SELECT earliest_ms FROM genesis_decisions WHERE ballot_id=?').get(first.ballotId);
  if(!decision || now<decision.earliest_ms) return 'Awaiting the founderâ€™s approved opening time.';
  const prev=db.prepare('SELECT state FROM collect_inventories WHERE tranche=?').get(row.tranche-1);
  if(!prev || (inventoryCounts(decode(prev.state)).unsold>0 && !first.inventoryOverrideReason)) {
    return 'The previous tranche still has available inventory.';
  }
  return null;
}

function checkEvidence(db,row,fixture,now) {
  requireBoundResult(db,row,fixture);
  id(fixture.proofId);
  need(fixture.finalized===true && fixture.commitment===row.commitment,'unverified_evidence','Expected finalized fixture evidence bound to the original commitment.');
  need(checkTimestamp(fixture.at)>=row.created_ms && fixture.at<=now,'invalid_evidence_time','Evidence timing is outside the observation period.');
  const prior=db.prepare('SELECT id FROM collect_operations WHERE proof_id=?').get(fixture.proofId);
  need(!prior || prior.id===row.id,'duplicate_proof','Proof already belongs to another operation.',409);
}
function saveReceipt(db,op,fixture,digest,receipt) {
  db.prepare('UPDATE collect_operations SET settled_ms=?,proof_id=?,evidence_digest=?,receipt=? WHERE id=? AND settled_ms IS NULL')
    .run(fixture.at,fixture.proofId,digest,encode(receipt),op.id);
}
function publicTraits(value) {
  need(value && ['model','backdrop','symbol'].every(k=>typeof value[k]==='string' && value[k].trim() && value[k].length<=128),
    'invalid_traits','Model, Backdrop and Symbol are required.');
  return {model:value.model,backdrop:value.backdrop,symbol:value.symbol};
}
/** Bind asset and reserve in one atomic transaction. The operator verifier is a
 * fixture boundary. No random draw or proof of mainnet fairness is produced here.
 */
export function fulfillMint(db,fixture,now=Date.now()) {
  const {operationId,assetId,proofId,at,ticket,commitment}=fixture;
  id(assetId);
  need(Number.isSafeInteger(at) && at%1000===0,'invalid_evidence_time','Vault bindings require a whole-second chain timestamp.');
  const visuals=publicTraits(fixture.traits);
  const digest=hash(['mint',operationId,assetId,proofId,at,ticket,commitment,visuals]);
  return transaction(db,()=>{
    const op=opFor(db,operationId);
    need(op?.kind==='mint','mint_not_found','Unknown mint operation.',404);
    checkEvidence(db,op,fixture,now);
    if(op.receipt) {
      need(op.evidence_digest===digest,'receipt_conflict','Finalized evidence cannot change.',409);
      return {...decode(op.receipt),replayed:true};
    }
    need(!db.prepare('SELECT id FROM collect_assets WHERE id=?').get(assetId),'asset_exists','NFT ID already bound.',409);
    const row=inventory(db,op.inventory_id),state=decode(row.state);
    const next=applyVerifiedMintDraw(state,{operationId,drawCommitment:commitment,proofId,ticket});
    const level=next.admissions[state.fulfilled].level;
    const ordinal=LEVEL_QUOTAS[level-1]-next.remaining[level-1]-1;
    const slot=row.kind==='genesis'?{kind:'genesis',tranche:row.tranche,level,ordinal}
      :{kind:'season',seasonId:row.id,slotIndex:LEVEL_QUOTAS.slice(0,level-1).reduce((a,b)=>a+b,0)+ordinal};
    const nft={id:assetId,owner:op.owner,level,traits:visuals,version:0,rerolls:0,eligibleAt:0,pending:null,
      expiresAt:row.kind==='season'?seasonExpiry(row.season_start,level):null};
    saveInventory(db,row,next);
    db.prepare('INSERT INTO collect_assets VALUES(?,?,?,?,?,NULL,?,?)').run(assetId,row.id,op.owner,at,at,encode(slot),encode(nft));
    observeAsset(db,{eventId:'collect:'+op.id,assetId,kind:'bind',at:iso(at),owner:op.owner,slot},now);
    if(row.kind==='season')db.prepare('INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref) VALUES(?,?,?,?)')
      .run(assetId,at,level,op.id);
    const receipt={operationId,assetId,at};
    saveReceipt(db,op,fixture,digest,receipt);
    return {...receipt,replayed:false};
  });
}

const assetFor=(db,assetId)=>{
  const asset=db.prepare('SELECT * FROM collect_assets WHERE id=?').get(id(assetId));
  need(asset,'asset_not_found','Unknown local collection asset.',404);
  return asset;
};
function progressionContext(db,inventoryId,targetId,materialId) {
  const row=inventory(db,inventoryId);
  need(row.kind==='season','season_required','Only Season assets support progression.',409);
  const rows=[assetFor(db,targetId)];
  if(materialId && materialId!==targetId) rows.push(assetFor(db,materialId));
  for(const asset of rows) {
    need(asset.inventory_id===inventoryId,'season_mismatch','Choose assets from the same Season.',409);
    need(asset.reveal_ms!==null,'metadata_unrevealed','Reveal the asset before progressing it.',409);
  }
  return {seasonId:row.id,start:row.season_start,assets:rows.map(a=>decode(a.asset)),operations:[]};
}
function writeProgression(db,state,at) {
  const write=db.prepare('UPDATE collect_assets SET asset=?,observed_ms=? WHERE id=? AND observed_ms<=?');
  for(const nft of state.assets) {
    const result=write.run(encode(nft),at,nft.id,at);
    need(result.changes===1,'asset_observation_order','Asset observation is out of order.',409);
  }
}

export function reserveProgression(db,{inventoryId,wallet,requestKey,request,now=Date.now()}) {
  const {kind,targetId,materialId,expectedTargetVersion,expectedMaterialVersion}=request;
  need(kind==='upgrade' || kind==='visual','invalid_kind','Choose an upgrade or visual reroll.');
  id(targetId);if(kind==='upgrade') id(materialId);
  const digest=hash([id(inventoryId),kind,targetId,materialId??null,expectedTargetVersion,expectedMaterialVersion??null]);
  return transaction(db,()=>{
    const prior=checkRetry(db,wallet,requestKey,digest);
    if(prior) return {operation:opView(prior),replayed:true};
    const control=actionDecision(db,'collection-progression',now);
    need(control.allowed,'scope_unavailable','New progression reservations are held: '+control.reason,503);
    const state=progressionContext(db,inventoryId,targetId,materialId);
    const opId=randomUUID(),commitment=randomUUID();
    const next=prepareProgression(state,{kind,operationId:opId,commitment,signer:wallet,targetId,
      expectedTargetVersion,materialId,expectedMaterialVersion,at:now});
    writeProgression(db,next,now);
    insertOperation(db,{opId,kind,inventoryId,owner:wallet,requestKey,digest,commitment,now,operation:next.operations[0]});
    return {operation:opView(opFor(db,opId)),replayed:false};
  });
}

export function quoteProgression(db,{inventoryId,wallet,request,now=Date.now()}) {
  const {kind,targetId,materialId,expectedTargetVersion,expectedMaterialVersion}=request;
  const state=progressionContext(db,inventoryId,targetId,materialId);
  const next=prepareProgression(state,{kind,operationId:'quote',commitment:'quote',signer:wallet,targetId,
    materialId,expectedTargetVersion,expectedMaterialVersion,at:now});
  const target=state.assets.find(nft=>nft.id===targetId);
  return jsonValue({kind,inventoryId,targetId,materialId:materialId??null,feeLamports:next.operations[0].feeLamports,
    ...(kind==='visual'?{level:target.level,cooldownMs:visualRerollQuote(target.rerolls,now).cooldownMs,
      fields:['Model','Backdrop','Symbol']}:{nextTargetLevel:target.level+1,
      nextTargetExpiry:iso(seasonExpiry(state.start,target.level+1)),materialProbabilities:expirySchedule(state.start,now).map((outcome,i)=>({...outcome,count:LEVEL_QUOTAS[i],total:1000}))}),
    asOf:iso(now),source:'local-fixture',executable:false});
}
export function fulfillProgression(db,fixture,now=Date.now()) {
  return transaction(db,()=>{
    const op=opFor(db,fixture.operationId);
    need(op && op.kind!=='mint','progression_not_found','Unknown progression operation.',404);
    checkEvidence(db,op,fixture,now);
    const output=op.kind==='visual'?publicTraits(fixture.traits):fixture.ticket;
    const digest=hash([op.kind,op.id,fixture.commitment,fixture.proofId,fixture.at,output]);
    if(op.receipt) {
      need(op.evidence_digest===digest,'receipt_conflict','Final progression evidence cannot change.',409);
      return {...decode(op.receipt),replayed:true};
    }
    const operation=decode(op.operation);
    const state=progressionContext(db,op.inventory_id,operation.targetId,operation.materialId);
    state.operations=[operation];
    const next=applyVerifiedProgressionDraw(state,{operationId:op.id,commitment:op.commitment,
      proofId:fixture.proofId,at:fixture.at,ticket:fixture.ticket,traits:op.kind==='visual'?output:undefined});
    if(op.kind==='upgrade'){
      const frozen=db.prepare('SELECT 1 FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id WHERE v.activated_ms>=? LIMIT 1')
        .get(fixture.at);
      need(!frozen,'historical_snapshot_conflict','Reconcile late Level evidence against the sealed launch before accepting it.',409);
      const insert=db.prepare('INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref) VALUES(?,?,?,?)');
      for(const asset of next.assets)insert.run(asset.id,fixture.at,asset.level,op.id);
    }
    writeProgression(db,next,fixture.at);
    const receipt={operationId:op.id,assetId:operation.targetId,materialId:operation.materialId,at:fixture.at};
    saveReceipt(db,op,fixture,digest,receipt);
    return {...receipt,replayed:false};
  });
}

/** External observation has a unique source ref and checked owner/version.
 * A pending escrow-style progression locks both assets until its own evidence
 * arrives. The operator cannot bypass this lock by changing ownership.
 */
export function observeCollectionAsset(db,fixture,now=Date.now()) {
  const {sourceId,assetId,kind,at}=fixture;
  id(sourceId);id(assetId);
  need(fixture.finalized===true && checkTimestamp(at)<=now,'unfinalized_observation','A finalized local observation is required.');
  need(['transfer','reveal'].includes(kind),'invalid_observation','Expected a transfer or reveal observation.');
  const digest=hash([kind,assetId,at,kind==='transfer'?address(fixture.from):null,kind==='transfer'?address(fixture.to):null]);
  return transaction(db,()=>{
    const prior=db.prepare('SELECT digest FROM collect_observations WHERE source_id=?').get(sourceId);
    if(prior) {
      need(prior.digest===digest,'observation_conflict','Observation ID already used.',409);
      return {sourceId,replayed:true};
    }
    const row=assetFor(db,assetId),nft=decode(row.asset);
    need(at>=row.observed_ms,'asset_observation_order','Asset evidence is out of order.',409);
    if(kind==='reveal') {
      need(row.reveal_ms===null,'already_revealed','This NFT has already been revealed.',409);
      db.prepare('UPDATE collect_assets SET reveal_ms=?,observed_ms=? WHERE id=?').run(at,at,assetId);
    } else {
      need(at%1000===0,'invalid_evidence_time','Vault transfers require a whole-second chain timestamp.');
      need(row.owner===fixture.from && fixture.to!==fixture.from,'wrong_owner','Transfer owner mismatch.',409);
      need(nft.pending===null,'asset_reserved','A pending progression holds this asset.',409);
      need(Number.isSafeInteger(nft.version+1),'version_overflow','Asset version cannot advance.',409);
      const updated={...nft,owner:fixture.to,version:nft.version+1};
      db.prepare('UPDATE collect_assets SET asset=?,owner=?,observed_ms=? WHERE id=?')
        .run(encode(updated),fixture.to,at,assetId);
      observeAsset(db,{eventId:'collect:'+hash(sourceId),assetId,kind:'transfer',at:iso(at),from:fixture.from,to:fixture.to},now);
    }
    db.prepare('INSERT INTO collect_observations VALUES(?,?,?,?,?)').run(sourceId,assetId,kind,at,digest);
    return {sourceId,replayed:false};
  });
}

function summarize(db,row,state,now,wallet) {
  const counts=inventoryCounts(state);
  const openingHold=trancheOpeningHold(db,row,state,now);
  const snapshots=new Map(db.prepare('SELECT stage_id,snapshot_hash FROM collect_snapshots WHERE inventory_id=? LIMIT 32').all(row.id).map(snapshot=>[snapshot.stage_id,snapshot.snapshot_hash]));
  const stages=state.stages.map(stage=>{
    const admissions=state.admissions.filter(a=>a.stageId===stage.id);
    let status='open';
    if(now<stage.opensAt) status='scheduled';
    else if(now>=stage.closesAt) status='closed';
    else if(admissions.length>=stage.allocation || counts.unsold===0) status='sold-out';
    else if(openingHold) status='postponed';
    else if(stage.type==='free' && stage.wallets===null) status='awaiting-snapshot';
    const mine=wallet?admissions.filter(a=>a.wallet===wallet).length:null;
    return jsonValue({id:stage.id,type:stage.type,status,opensAt:iso(stage.opensAt),closesAt:iso(stage.closesAt),
      publishedAt:iso(stage.publishedAt),priceLamports:stage.priceLamports,costLamports:stage.costLamports,
      allocation:stage.allocation,available:Math.min(counts.unsold,stage.allocation-admissions.length),
      walletLimit:stage.walletLimit,eligibility:stageEligibility(stage,wallet),
      eligible:stageEligibility(stage,wallet).status==='unknown'?null:stageEligibility(stage,wallet).status==='eligible',
      walletReservations:mine,termsDigest:stage.termsDigest,openingHold,
      reservationStatus:stageReservationStatus(stage,wallet,{now,status,used:mine,openingHold,snapshotId:snapshots.get(stage.id)??null})});
  });
  return {id:row.id,kind:row.kind,tranche:row.tranche,seasonStart:row.season_start==null?null:iso(row.season_start),
    capacity:state.slots,...inventoryDisclosure(db,row.id,counts,row.season_start,now),initialLevelQuotas:LEVEL_QUOTAS,stages,source:'local-fixture',executable:false};
}
export function listInventories(db,{now=Date.now(),after='',wallet=null}) {
  const rows=db.prepare('SELECT * FROM collect_inventories WHERE id>? ORDER BY id LIMIT 26').all(after);
  return {items:rows.slice(0,25).map(row=>summarize(db,row,decode(row.state),now,wallet)),
    nextCursor:rows.length>25?rows[24].id:null,source:'local-fixture'};
}
export function readInventory(db,id,now=Date.now(),wallet=null) {
  const row=inventory(db,id);
  return summarize(db,row,decode(row.state),now,wallet);
}
export function readCollectionAsset(db,assetId) {
  const row=assetFor(db,assetId);
  const nft=decode(row.asset);
  const ownerEvidence=db.prepare("SELECT observed_ms FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1").get(assetId);
  return {id:row.id,inventoryId:row.inventory_id,owner:row.owner,revealStatus:row.reveal_ms===null?'unrevealed':'revealed',
    revealedAt:row.reveal_ms===null?null:iso(row.reveal_ms),ownerObservedAt:row.reveal_ms!==null&&ownerEvidence?iso(ownerEvidence.observed_ms):null,evidenceStatus:'local-fixture',
    ...(row.reveal_ms===null?{}:{level:nft.level,traits:nft.traits,version:nft.version,
      rerolls:nft.rerolls,nextRerollAt:nft.eligibleAt?iso(nft.eligibleAt):null,
      expiresAt:nft.expiresAt?iso(nft.expiresAt):null,operationPending:nft.pending!==null}),
    source:'local-fixture',executable:false};
}
export function listOwnedAssets(db,wallet,after='') {
  const rows=db.prepare('SELECT id FROM collect_assets WHERE owner=? AND id>? ORDER BY id LIMIT 26').all(wallet,after);
  return {items:rows.slice(0,25).map(row=>readCollectionAsset(db,row.id)),nextCursor:rows.length>25?rows[24].id:null};
}
export function listOwnOperations(db,wallet,after='') {
  const rows=db.prepare('SELECT * FROM collect_operations WHERE owner=? AND id>? ORDER BY id LIMIT 26').all(wallet,after);
  return {items:rows.slice(0,25).map(opView),nextCursor:rows.length>25?rows[24].id:null};
}
export function readOwnOperation(db,wallet,opId) {
  const row=db.prepare('SELECT * FROM collect_operations WHERE id=? AND owner=?').get(id(opId),address(wallet));
  need(row,'operation_not_found','Unknown wallet operation.',404);
  return opView(row);
}
/** Operator-only evidence handoff. Never expose the full stored commitment or
 * reservation queue through a public projection before proof verification.
 */
export function inspectOperation(db,opId) {
  const op=opFor(db,opId);
  need(op,'operation_not_found','Unknown operation.',404);
  return {...opView(op),commitment:op.commitment};
}
