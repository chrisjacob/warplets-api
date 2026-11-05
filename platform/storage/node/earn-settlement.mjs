import { DAY_MS, MIN_STAKE_MICRO_USD, allocationWindow } from '../../domain/earn/index.mjs';
import { nat, name, requireValue } from '../../earn/validation.mjs';
import { deriveComponents } from '../../earn/components.mjs';
import { verifiedStakeAt } from '../../pricing/evidence.mjs';
import { readLeaderboard } from './earn-workflow.mjs';
const pending=(epoch,reason)=>({result:{mode:'local-fixture',status:'pending',epoch,reason}});
// Call within a synchronous transaction to capture a consistent reference read.
export function loadReferenceBoard(db,{epoch,nowMs,sourceComplete,sourceRef}) {
  nat(epoch,'epoch');nat(nowMs,'now');name(sourceRef,'source reference');
  if(db.prepare('SELECT 1 FROM earn_boards WHERE epoch=?').get(epoch))return {result:readLeaderboard(db,epoch)};
  const cutoff=(epoch+1)*DAY_MS-1;
  if(nowMs<=cutoff)return pending(epoch,'board-open');
  if(sourceComplete!==true)return pending(epoch,'incomplete-source');
  if(db.prepare(`SELECT 1 FROM earn_submissions s WHERE s.epoch=?
    AND NOT EXISTS(SELECT 1 FROM earn_boards b WHERE b.epoch=s.epoch) LIMIT 1`).get(epoch-1))return pending(epoch,'previous-board');
  const posts=db.prepare(`SELECT s.*,r.content_score,r.reviewed_ms,r.source_ref AS review_ref,r.reason,r.moderator,
    e.micro_usd AS entry_micro_usd FROM earn_submissions s JOIN earn_stake_reads e ON e.id=s.entry_read_id
    LEFT JOIN earn_reviews r ON r.submission_id=s.id WHERE s.epoch=? ORDER BY s.id`).all(epoch);
  const closingStake=Object.create(null),facts=Object.create(null),previousStreaks=Object.create(null);
  for(const post of posts) {
    const read=post.content_score>0?verifiedStakeAt(db,post.wallet,post.token_id,cutoff):null;
    closingStake[post.id]=read?{id:read.id,micro_usd:read.micro_usd}:null;
    if(read&&BigInt(read.micro_usd)>=MIN_STAKE_MICRO_USD)facts[post.wallet]=deriveComponents(db,epoch,post.wallet);
  }
  const late=db.prepare(`SELECT s.wallet,r.reviewed_ms,d.qualified FROM earn_reviews r
    JOIN earn_submissions s ON s.id=r.submission_id LEFT JOIN earn_decisions d ON d.submission_id=s.id
    WHERE r.reviewed_ms BETWEEN ? AND ? AND s.epoch<? AND r.content_score>0`).all(epoch*DAY_MS,cutoff,epoch);
  for(const wallet of new Set([...posts.map(p=>p.wallet),...late.map(p=>p.wallet)])) {
    previousStreaks[wallet]=db.prepare('SELECT epoch,days,last_approval_ms AS lastApprovalMs FROM earn_streaks WHERE epoch=? AND wallet=?').get(epoch-1,wallet)??null;
  }
  const campaigns=db.prepare(`SELECT DISTINCT c.token_id AS tokenId,c.activation_ms AS activationMs
    FROM earn_fixture_campaigns c JOIN earn_submissions s ON s.token_id=c.token_id WHERE s.epoch=? ORDER BY c.token_id`).all(epoch);
  return {input:{epoch,cutoff,nowMs,sourceRef,posts,closingStake,facts,late,previousStreaks,campaigns}};
}
export function saveReferenceBoard(db,plan) {
  db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(plan.epoch,JSON.stringify(plan.winners),plan.finalizedAtMs,plan.snapshotId,plan.sourceRef);
  const saveFacts=db.prepare(`INSERT INTO earn_member_facts VALUES(?,?,?,?)
    ON CONFLICT(epoch,wallet) DO UPDATE SET payload=excluded.payload,source_ref=excluded.source_ref`);
  for(const [wallet,ref,payload] of plan.factSources)saveFacts.run(plan.epoch,wallet,payload,ref);
  const saveDecision=db.prepare('INSERT INTO earn_decisions VALUES(?,?,?,?)');
  for(const d of plan.decisions)saveDecision.run(d.submissionId,plan.epoch,Number(d.qualified),d.cutoffEvidence);
  const saveStreak=db.prepare('INSERT INTO earn_streaks VALUES(?,?,?,?)');
  for(const s of plan.streaks)saveStreak.run(plan.epoch,s.wallet,s.days,s.lastApprovalMs);
  return readLeaderboard(db,plan.epoch);
}

export function loadReferenceAllocation(db,{tokenId,day,nowMs}) {
  name(tokenId,'token');nat(nowMs,'now');requireValue(Number.isInteger(day)&&day>=1&&day<=10,'Invalid campaign day.');
  const campaign=db.prepare('SELECT * FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
  requireValue(campaign,'Unknown fixture campaign.');
  const stored=db.prepare('SELECT * FROM earn_allocations WHERE token_id=? AND day=?').get(tokenId,day);
  if(stored)return {result:{mode:'local-fixture',status:'recorded',allocation:{...stored}}};
  const window=allocationWindow(campaign.activation_ms,day);
  const board=db.prepare('SELECT epoch,winners,snapshot_hash FROM earn_boards WHERE epoch=?').get(window.boardEpoch);
  return {input:{tokenId,day,nowMs,originalSupplyUnits:campaign.original_units,activationMs:campaign.activation_ms,
    board:board?{epoch:board.epoch,status:'final',winners:JSON.parse(board.winners)}:null},priorBoardDigest:board?.snapshot_hash??null};
}
export function saveReferenceAllocation(db,plan) {
  db.prepare('INSERT INTO earn_allocations VALUES(?,?,?,?,?,?,?,?)').run(plan.tokenId,plan.day,plan.boardEpoch,
    plan.startsAtMs,plan.vestsFromMs,plan.vestsThroughMs,plan.budgetUnits,plan.burnUnits);
  const save=db.prepare('INSERT INTO earn_awards VALUES(?,?,?,?)');
  for(const award of plan.awards)save.run(plan.tokenId,plan.day,award.wallet,award.amountUnits);
  return {mode:'local-fixture',status:'recorded',allocation:{...db.prepare('SELECT * FROM earn_allocations WHERE token_id=? AND day=?').get(plan.tokenId,plan.day)}};
}
