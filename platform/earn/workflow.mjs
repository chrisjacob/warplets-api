import { randomUUID } from 'node:crypto';
import { transaction } from '../storage/database.mjs';
import { DAY_MS, MIN_STAKE_MICRO_USD, advanceStreak, allocationWindow, claimableUnits, epochAt,
  onboardingTenths, rankBoard, settleAllocation } from '../domain/earn/index.mjs';
import { EarnError, conflict, decimal, digest, name, nat, requireValue } from './checks.mjs';
import { deriveComponents } from './components.mjs';
import { readRecoveredClaims, readRecoveredLeaderboard, recoveryMode } from './archive.mjs';
export { EarnError } from './checks.mjs';
function canonicalUrl(text) {
  requireValue(typeof text==='string' && text.length<=2048, 'Provide one HTTPS content URL.');
  let url;
  try { url = new URL(text); } catch { throw new EarnError(400,'invalid_input','Invalid content URL.'); }
  requireValue(url.protocol==='https:' && !url.username && !url.password && !url.port
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,63}$/i.test(url.hostname)
    && !/\.(?:localhost|local|internal|lan|home)$/i.test(url.hostname), 'Use a public HTTPS content URL.');
  return url.href;
}
function pending(epoch,reason) { return { mode:'local-fixture',status:'pending',epoch,reason }; }
export const MAX_STAKE_AGE_MS = 5*60_000;
export const PILOT_BOARD_CAPACITY = 100;

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

export function recordStakeRead(db,{wallet,tokenId,observedMs,expiresMs,microUsd,sourceRef}) {
  name(wallet,'wallet');name(tokenId,'token');name(sourceRef,'source reference');decimal(microUsd,'stake valuation');
  nat(observedMs,'observation');nat(expiresMs,'expiry');
  requireValue(expiresMs>=observedMs && expiresMs-observedMs<=MAX_STAKE_AGE_MS,'A stake read may cover at most five minutes.');
  const id=digest([wallet,tokenId,observedMs,expiresMs,microUsd,sourceRef]);
  return transaction(db,()=>{
    const existing=db.prepare('SELECT id FROM earn_stake_reads WHERE wallet=? AND token_id=? AND observed_ms=?').get(wallet,tokenId,observedMs);
    if (existing && existing.id!==id) conflict('evidence_conflict','A different read exists at that checkpoint.');
    if (!existing) db.prepare('INSERT INTO earn_stake_reads VALUES(?,?,?,?,?,?,?)').run(id,wallet,tokenId,observedMs,expiresMs,microUsd,sourceRef);
    return {id};
  });
}

function readAt(db,wallet,tokenId,time) {
  // Never fall back to an older quote once a newer observation has expired.
  const read=db.prepare('SELECT * FROM earn_stake_reads WHERE wallet=? AND token_id=? AND observed_ms<=? ORDER BY observed_ms DESC LIMIT 1')
    .get(wallet,tokenId,time);
  return read && read.expires_ms>=time ? read : null;
}
const publicSubmission = r => ({id:r.id,tokenId:r.token_id,epoch:r.epoch,url:r.url,submittedAtMs:r.submitted_ms});

export function submitContent(db,{wallet,tokenId,url,requestKey,nowMs}) {
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
    const campaign=db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    if (!campaign || nowMs<campaign.activation_ms || nowMs>=campaign.activation_ms+10*DAY_MS) {
      conflict('campaign_inactive','Select an active local campaign.');
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch)) conflict('board_closed','Board already finalized.');
    if (db.prepare('SELECT 1 FROM earn_submissions WHERE epoch=? AND wallet=? AND token_id=?').get(epoch,wallet,tokenId)) {
      conflict('already_submitted','You already submitted for this token today.');
    }
    if (db.prepare('SELECT COUNT(*) AS n FROM earn_submissions WHERE epoch=?').get(epoch).n>=PILOT_BOARD_CAPACITY) {
      conflict('board_capacity','Pilot moderation slots are full for today.');
    }
    const read=readAt(db,wallet,tokenId,nowMs);
    if (!read) throw new EarnError(503,'stake_evidence_pending','A current position read is required. Retry when the evidence is available.');
    if (BigInt(read.micro_usd)<MIN_STAKE_MICRO_USD) throw new EarnError(422,'stake_ineligible','The token requires at least $10 staked.');
    const id=randomUUID();
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

function stakeEvidence(row,wallet,tokenId,asOfMs) {
  return row ? { status:'verified',userId:wallet,tokenId,asOfMs,microUsd:BigInt(row.micro_usd) } : null;
}

// Single writer transaction seals the completeness attestation, decisions and
// payout ranking together. Reopening the database returns the same published board.
export function finalizeBoard(db,{epoch,nowMs,sourceComplete,sourceRef}) {
  nat(epoch,'epoch');nat(nowMs,'now');name(sourceRef,'source reference');
  const cutoff=(epoch+1)*DAY_MS-1;
  return transaction(db,()=>{
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch)) return readLeaderboard(db,epoch);
    if (nowMs<=cutoff) return pending(epoch,'board-open');
    if (sourceComplete!==true) return pending(epoch,'incomplete-source');
    // The previous day's admissions must be closed before their streak evidence can be consumed.
    const previousOpen=db.prepare(`SELECT 1 FROM earn_submissions s WHERE s.epoch=?
      AND NOT EXISTS(SELECT 1 FROM earn_boards b WHERE b.epoch=s.epoch) LIMIT 1`).get(epoch-1);
    if (previousOpen) return pending(epoch,'previous-board');
    const posts=db.prepare(`SELECT s.*,r.content_score,r.reviewed_ms,r.source_ref AS review_ref,r.reason,r.moderator,
      e.micro_usd AS entry_micro_usd FROM earn_submissions s JOIN earn_stake_reads e ON e.id=s.entry_read_id
      LEFT JOIN earn_reviews r ON r.submission_id=s.id WHERE s.epoch=? ORDER BY s.id`).all(epoch);
    const decisions=[];
    const submissions=[];
    const qualifiedWallets=new Set();
    const approvals=new Map();
    function noteApproval(wallet,when) {
      const times=approvals.get(wallet) ?? [];
      times.push(when);
      approvals.set(wallet,times);
    }
    for (const post of posts) {
      if (post.content_score==null || post.reviewed_ms>nowMs) return pending(epoch,'moderation');
      const read=post.content_score>0 ? readAt(db,post.wallet,post.token_id,cutoff) : null;
      if (!read && post.content_score>0) return pending(epoch,'stake-evidence');
      const qualified=post.content_score>0 && BigInt(read.micro_usd)>=MIN_STAKE_MICRO_USD;
      decisions.push({submissionId:post.id,qualified,cutoffEvidence:read?.id??null});
      submissions.push({submissionId:post.id,userId:post.wallet,tokenId:post.token_id,submittedAtMs:post.submitted_ms,
        contentScore:post.content_score,atSubmission:stakeEvidence({micro_usd:post.entry_micro_usd},post.wallet,post.token_id,post.submitted_ms),
        atSnapshot:stakeEvidence(read,post.wallet,post.token_id,cutoff)});
      if (qualified) {
        qualifiedWallets.add(post.wallet);
        if (epochAt(post.reviewed_ms)===epoch) noteApproval(post.wallet,post.reviewed_ms);
      }
    }
    // A delayed moderation decision still references the original board; its
    // qualifying approval advances the streak only in the UTC day it happened.
    const late=db.prepare(`SELECT s.wallet,r.reviewed_ms,d.qualified FROM earn_reviews r
      JOIN earn_submissions s ON s.id=r.submission_id LEFT JOIN earn_decisions d ON d.submission_id=s.id
      WHERE r.reviewed_ms BETWEEN ? AND ? AND s.epoch<? AND r.content_score>0`).all(epoch*DAY_MS,cutoff,epoch);
    for (const row of late) {
      if (row.qualified==null) return pending(epoch,'unsettled-approval');
      if (row.qualified) noteApproval(row.wallet,row.reviewed_ms);
    }
    const streaks=new Map();
    for (const [wallet,times] of approvals) {
      const prev=db.prepare('SELECT epoch,days,last_approval_ms AS lastApprovalMs FROM earn_streaks WHERE epoch=? AND wallet=?').get(epoch-1,wallet);
      streaks.set(wallet,advanceStreak({epoch,previous:prev,approvalsMs:times}));
    }
    const participants=[];
    const factSources=[];
    for (const wallet of qualifiedWallets) {
      const fact=deriveComponents(db,epoch,wallet);
      if (fact.status!=='ready') return pending(epoch,fact.reason);
      participants.push({userId:wallet,wallet,components:{...fact.components,streakDays:streaks.get(wallet)?.days??0}});
      factSources.push([wallet,fact.sourceRef,fact.payload]);
    }
    const campaigns=db.prepare(`SELECT DISTINCT c.token_id AS tokenId,c.activation_ms AS activationMs
      FROM earn_fixture_campaigns c JOIN earn_submissions s ON s.token_id=c.token_id WHERE s.epoch=? ORDER BY c.token_id`).all(epoch);
    const board=rankBoard({epoch,complete:true,campaigns,participants,submissions});
    if (board.status!=='final') return pending(epoch,board.reason);
    const hash=digest({policy:'prd-1.2',epoch,posts,decisions,campaigns,participants,factSources,late,sourceRef,winners:board.winners});
    db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch,JSON.stringify(board.winners),nowMs,hash,sourceRef);
    const saveFacts=db.prepare(`INSERT INTO earn_member_facts VALUES(?,?,?,?)
      ON CONFLICT(epoch,wallet) DO UPDATE SET payload=excluded.payload,source_ref=excluded.source_ref`);
    for (const [wallet,ref,payload] of factSources) saveFacts.run(epoch,wallet,payload,ref);
    const saveDecision=db.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)');
    for (const d of decisions) saveDecision.run(d.submissionId,epoch,Number(d.qualified),d.cutoffEvidence);
    const saveStreak=db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)');
    for (const [wallet,s] of streaks) saveStreak.run(epoch,wallet,s.days,s.lastApprovalMs);
    return readLeaderboard(db,epoch);
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

export function recordAllocation(db,{tokenId,day,nowMs}) {
  name(tokenId,'token');nat(nowMs,'now');requireValue(Number.isInteger(day)&&day>=1&&day<=10,'Invalid campaign day.');
  return transaction(db,()=>{
    const campaign=db.prepare('SELECT * FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    requireValue(campaign,'Unknown fixture campaign.');
    const window=allocationWindow(campaign.activation_ms,day);
    const stored=db.prepare('SELECT * FROM earn_allocations WHERE token_id=? AND day=?').get(tokenId,day);
    if (stored) return {mode:'local-fixture',status:'recorded',allocation:{...stored}};
    const board=db.prepare('SELECT epoch,winners FROM earn_boards WHERE epoch=?').get(window.boardEpoch);
    const plan=settleAllocation({tokenId,originalSupplyUnits:BigInt(campaign.original_units),activationMs:campaign.activation_ms,
      day,nowMs,board:board ? {epoch:board.epoch,status:'final',winners:JSON.parse(board.winners)} : undefined});
    if (plan.status!=='ready') return {mode:'local-fixture',status:plan.status,tokenId,day,epoch:plan.boardEpoch};
    db.prepare('INSERT INTO earn_allocations VALUES(?,?,?,?,?,?,?,?)').run(tokenId,day,plan.boardEpoch,
      plan.startsAtMs,plan.vestsFromMs,plan.vestsThroughMs,String(plan.budgetUnits),String(plan.burnUnits));
    const save=db.prepare('INSERT INTO earn_awards VALUES(?,?,?,?)');
    for (const award of plan.awards) save.run(tokenId,day,award.wallet,String(award.amountUnits));
    return {mode:'local-fixture',status:'recorded',allocation:{...db.prepare('SELECT * FROM earn_allocations WHERE token_id=? AND day=?').get(tokenId,day)}};
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
