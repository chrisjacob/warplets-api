// Node reference persistence. Transactions remain synchronous; portable services
// call this implementation only through named repository commands.
import { loadReferenceBoard, saveReferenceBoard, loadReferenceAllocation, saveReferenceAllocation } from './earn-settlement.mjs';
import { computeBoard, computeAllocation } from '../../earn/settlement.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { DAY_MS, MIN_STAKE_MICRO_USD, claimableUnits, epochAt, onboardingTenths } from '../../domain/earn/index.mjs';
import { EarnError, conflict, decimal, digest, name, nat, requireValue } from '../../earn/checks.mjs';
import { readRecoveredClaims, readRecoveredLeaderboard, recoveryMode } from '../../earn/archive.mjs';
import { verifiedStakeAt as readAt } from '../../pricing/evidence.mjs';
import { capacityAt } from '../../earn/operations.mjs';
import { actionDecision } from '../../operations/controls.mjs';
export { PILOT_BOARD_CAPACITY } from '../../earn/operations.mjs';
export { EarnError } from '../../earn/checks.mjs';
import { canonicalContentUrl as canonicalUrl } from '../../earn/validation.mjs';
function pending(epoch,reason) { return { mode:'local-fixture',status:'pending',epoch,reason }; }

export function addCampaign(db,{tokenId,activationMs,originalUnits}) {
  name(tokenId,'token'); nat(activationMs,'activation');
  const supply = decimal(originalUnits,'supply');
  requireValue(supply>0n && supply%100n===0n,'Supply must support ten exact 1% budgets.');
  return transaction(db,()=>{
    const existing=db.prepare('SELECT * FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    if (existing) {
      if (existing.activation_ms!==activationMs || existing.original_units!==originalUnits) conflict('campaign_conflict','Campaign already exists.');
      return existing;
    }
    const intersecting=db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE activation_ms<? AND activation_ms>?')
      .all(activationMs+10*DAY_MS,activationMs-10*DAY_MS);
    const times=[activationMs,...intersecting.map(c=>c.activation_ms)];
    // New campaign must never be the eleventh, including scheduled future overlaps.
    if (times.some(t=>times.filter(t0=>t0<=t && t<t0+10*DAY_MS).length>10)) conflict('campaign_capacity','At most ten active campaigns.');
    db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,activationMs,originalUnits);
    return db.prepare('SELECT * FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
  });
}

const publicSubmission = r => ({id:r.id,tokenId:r.token_id,epoch:r.epoch,url:r.url,submittedAtMs:r.submitted_ms});

export function submitContent(db,{wallet,tokenId,url,requestKey,nowMs},{ids={next:randomUUID}}={}) {
  name(wallet,'wallet');name(tokenId,'token');
  requireValue(typeof requestKey==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(requestKey),'Supply an Idempotency-Key of 1–128 characters.');
  url=canonicalUrl(url);
  const epoch=epochAt(nowMs);
  return transaction(db,()=>{
    const prior=db.prepare('SELECT * FROM earn_submissions WHERE wallet=? AND request_key=?').get(wallet,requestKey);
    if (prior) {
      if (prior.token_id!==tokenId || prior.url!==url) conflict('idempotency_conflict','Key already used for different content.');
      return {submission:publicSubmission(prior),replay:true};
    }
    const admission=actionDecision(db,'earn-admission',nowMs);
    if (!admission.allowed) throw new EarnError(503,'scope_unavailable','New admissions temporarily held: '+admission.reason+'.');
    const campaign=db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    if (!campaign || nowMs<campaign.activation_ms || nowMs>=campaign.activation_ms+10*DAY_MS) {
      conflict('campaign_inactive','Select an active local campaign.');
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch)) conflict('board_closed','Board already finalized.');
    if (db.prepare('SELECT 1 FROM earn_submissions WHERE epoch=? AND wallet=? AND token_id=?').get(epoch,wallet,tokenId)) {
      conflict('already_submitted','You already submitted for this token today.');
    }
    if (!capacityAt(db,epoch,nowMs).accepting) {
      conflict('board_capacity','Pilot moderation slots are full for today.');
    }
    const read=readAt(db,wallet,tokenId,nowMs);
    if (!read) throw new EarnError(503,'stake_evidence_pending','A current position read is required. Retry when the evidence is available.');
    if (BigInt(read.micro_usd)<MIN_STAKE_MICRO_USD) throw new EarnError(422,'stake_ineligible','The token requires at least $10 staked.');
    const id=ids.next();
    db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,wallet,tokenId,epoch,url,nowMs,read.id,requestKey);
    return {submission:{id,tokenId,epoch,url,submittedAtMs:nowMs},replay:false};
  });
}

export function recordReview(db,{submissionId,score,reason,moderator,sourceRef,reviewedMs}) {
  name(submissionId,'submission');name(reason,'score reason');name(moderator,'moderator');name(sourceRef,'source reference');
  nat(reviewedMs,'review time');requireValue(Number.isInteger(score)&&score>=0&&score<=10,'Score must be 0–10.');
  return transaction(db,()=>{
    const post=db.prepare('SELECT * FROM earn_submissions WHERE id=?').get(submissionId);
    requireValue(post && reviewedMs>=post.submitted_ms,'Review time must follow submission.');
    const row=db.prepare('SELECT * FROM earn_reviews WHERE submission_id=?').get(submissionId);
    if (row) {
      if (row.content_score!==score || row.reason!==reason || row.moderator!==moderator || row.source_ref!==sourceRef || row.reviewed_ms!==reviewedMs) {
        conflict('review_final','The moderation decision is final.');
      }
      return row;
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch IN (?,?)').get(post.epoch,epochAt(reviewedMs))) conflict('board_closed','Review checkpoint is finalized.');
    db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(submissionId,score,moderator,reason,reviewedMs,sourceRef);
    return db.prepare('SELECT * FROM earn_reviews WHERE submission_id=?').get(submissionId);
  });
}

// Compatibility wrapper retains synchronous CLI behavior. Application callers
// use the repository's read/compute/guarded-commit boundary instead.
export function finalizeBoard(db,args) {
  return transaction(db,()=>{
    const loaded=loadReferenceBoard(db,args);
    if(loaded.result)return loaded.result;
    const plan=computeBoard(loaded.input);
    if(plan.status!=='ready')return pending(args.epoch,plan.reason);
    return saveReferenceBoard(db,{...plan,snapshotId:digest(plan.commitmentInput),finalizedAtMs:args.nowMs});
  });
}

export function readLeaderboard(db,epoch) {
  nat(epoch,'epoch');
  if (recoveryMode(db)) return readRecoveredLeaderboard(db,epoch);
  const row=db.prepare('SELECT * FROM earn_boards WHERE epoch=?').get(epoch);
  const date=new Date(epoch*DAY_MS).toISOString().slice(0,10);
  const items=row ? JSON.parse(row.winners).map((w,i)=>({rank:i+1,...w})) : [];
  const allocations=db.prepare(`SELECT token_id AS tokenId,day,budget AS budgetUnits,burn AS burnUnits,
    vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs FROM earn_allocations WHERE epoch=? ORDER BY token_id,day`).all(epoch);
  return {mode:'local-fixture',epoch,date,status:row?'final':'pending',items,allocations,
    snapshotId:row?.snapshot_hash??null,finalizedAtMs:row?.finalized_ms??null};
}

export function recordAllocation(db,args) {
  return transaction(db,()=>{
    const loaded=loadReferenceAllocation(db,args);
    if(loaded.result)return loaded.result;
    const plan=computeAllocation(loaded.input);
    if(plan.status!=='ready')return {mode:'local-fixture',status:plan.status,tokenId:args.tokenId,day:args.day,epoch:plan.boardEpoch};
    return saveReferenceAllocation(db,plan);
  });
}

export function readWalletClaims(db,{wallet,nowMs,after=0}) {
  nat(after,'cursor');
  if (recoveryMode(db)) return readRecoveredClaims(db,{wallet,nowMs,after});
  const rows=db.prepare(`SELECT a.rowid AS cursor,a.token_id AS tokenId,a.day,a.amount,
    c.vests_from_ms AS vestsFromMs,c.vests_through_ms AS vestsThroughMs FROM earn_awards a
    JOIN earn_allocations c ON c.token_id=a.token_id AND c.day=a.day
    WHERE a.wallet=? AND a.rowid>? ORDER BY a.rowid LIMIT 51`).all(wallet,after);
  const items=rows.slice(0,50).map(row=>({tokenId:row.tokenId,day:row.day,awardUnits:row.amount,
    vestedUnits:String(claimableUnits({awardedUnits:BigInt(row.amount),claimedUnits:0n,window:row,nowMs})),
    vestsFromMs:row.vestsFromMs,vestsThroughMs:row.vestsThroughMs}));
  return {mode:'local-fixture',executionEnabled:false,items,nextCursor:rows.length>50?rows[49].cursor:null};
}

export function readWalletSubmissions(db,{wallet,after=0}) {
  nat(after,'cursor');
  const rows=db.prepare(`SELECT s.rowid AS cursor,s.*,b.snapshot_hash,r.content_score,r.reason,d.qualified,
    f.payload AS member_payload, f.source_ref AS member_source, sk.days AS streak_days,
    e.micro_usd AS entry_stake, c.micro_usd AS closing_stake
    FROM earn_submissions s LEFT JOIN earn_boards b ON b.epoch=s.epoch
    LEFT JOIN earn_reviews r ON r.submission_id=s.id LEFT JOIN earn_decisions d ON d.submission_id=s.id
    LEFT JOIN earn_member_facts f ON f.epoch=s.epoch AND f.wallet=s.wallet
    LEFT JOIN earn_streaks sk ON sk.epoch=s.epoch AND sk.wallet=s.wallet
    JOIN earn_stake_reads e ON e.id=s.entry_read_id LEFT JOIN earn_stake_reads c ON c.id=d.snapshot_read_id
    WHERE s.wallet=? AND s.rowid>? ORDER BY s.rowid LIMIT 51`).all(wallet,after);
  const items=rows.slice(0,50).map(row=>{
    let components=null;
    if (row.snapshot_hash && row.member_payload) {
      const m=JSON.parse(row.member_payload);
      components={actionTenths:onboardingTenths(row.epoch,m.intervals,m.completions),streakDays:row.streak_days??0,
        highestEligibleLevel:m.highestEligibleLevel,purchaseTokenDays:m.purchaseTokenDays,sourceRef:row.member_source};
    }
    return {...publicSubmission(row),status:row.snapshot_hash?'final':'pending',
      score:row.snapshot_hash ? row.content_score : null,eligible:row.snapshot_hash ? Boolean(row.qualified) : null,
      reason:row.snapshot_hash ? row.reason : null,components,entryStakeMicroUsd:row.entry_stake,
      closingStakeMicroUsd:row.snapshot_hash ? row.closing_stake : null};
  });
  return {mode:'local-fixture',items,nextCursor:rows.length>50?rows[49].cursor:null};
}
