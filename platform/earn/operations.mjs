import { DAY_MS, epochAt } from '../domain/earn/index.mjs';
import { transaction } from '../storage/database.mjs';
import { conflict, digest, name, nat, requireValue } from './checks.mjs';

export const PILOT_BOARD_CAPACITY=100;
export function configureWorkload(db,{effectiveEpoch,atMs,staffedMinutes,secondsPerReview,admissionLimit,operator,reason}) {
  nat(effectiveEpoch,'epoch');nat(atMs,'effective change time');name(operator,'operator');name(reason,'reason');
  requireValue(effectiveEpoch>=epochAt(atMs),'Capacity changes must be current or prospective.');
  requireValue(Number.isInteger(staffedMinutes)&&staffedMinutes>=0&&staffedMinutes<=1440,'Staffed minutes must be 0–1440.');
  requireValue(Number.isInteger(secondsPerReview)&&secondsPerReview>=1&&secondsPerReview<=3600,'Review estimate must be 1–3600 seconds.');
  requireValue(Number.isInteger(admissionLimit)&&admissionLimit>=0&&admissionLimit<=PILOT_BOARD_CAPACITY,'Pilot limit must be 0–100.');
  const revision=digest([effectiveEpoch,atMs,staffedMinutes,secondsPerReview,admissionLimit,operator,reason]);
  return transaction(db,()=>{
    const same=db.prepare('SELECT revision FROM earn_workload_policies WHERE effective_epoch=? AND recorded_ms=?').get(effectiveEpoch,atMs);
    if (same && same.revision!==revision) conflict('workload_conflict','Different workload change at this time.');
    if (!same) {
      if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1').get(effectiveEpoch)) conflict('board_closed','A capacity change cannot rewrite a finalized board.');
      db.prepare('INSERT INTO earn_workload_policies VALUES(?,?,?,?,?,?,?,?)')
        .run(revision,effectiveEpoch,atMs,staffedMinutes,secondsPerReview,admissionLimit,operator,reason);
    }
    return {revision,effectiveEpoch,limit:Math.min(admissionLimit,Math.floor(staffedMinutes*60/secondsPerReview))};
  });
}

export function capacityAt(db,epoch,nowMs) {
  nat(epoch,'epoch');nat(nowMs,'now');
  const row=db.prepare(`SELECT * FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=?
    ORDER BY effective_epoch DESC, recorded_ms DESC LIMIT 1`).get(epoch,nowMs);
  const limit=row ? Math.min(row.admission_limit,Math.floor(row.staffed_minutes*60/row.seconds_per_review)):PILOT_BOARD_CAPACITY;
  const admitted=db.prepare('SELECT admitted FROM earn_admission_counts WHERE epoch=?').get(epoch)?.admitted??0;
  const remaining=Math.max(0,limit-admitted);
  return {epoch,limit,admitted,remaining,accepting:epochAt(nowMs)===epoch&&remaining>0,policy:row?.revision??'pilot-default'};
}

function parseCursor(cursor,epoch,state) {
  if (!cursor) return null;
  try {
    requireValue(typeof cursor==='string'&&cursor.length<512,'Invalid cursor.');
    const data=JSON.parse(Buffer.from(cursor,'base64url').toString());
    requireValue(data.epoch===epoch&&data.state===state&&Number.isSafeInteger(data.last)&&Number.isSafeInteger(data.ceiling)
      &&data.last>=0&&data.ceiling>=data.last,'Cursor does not belong to this queue.');
    return data;
  } catch { requireValue(false,'Invalid queue cursor.'); }
}

export function moderatorQueue(db,{epoch,state='pending',limit=25,cursor=null}) {
  nat(epoch,'epoch');requireValue(state==='pending'||state==='reviewed','Unknown queue state.');
  requireValue(Number.isInteger(limit)&&limit>=1&&limit<=100,'Page size must be 1–100.');
  const previous=parseCursor(cursor,epoch,state);
  const ceiling=previous?.ceiling??db.prepare('SELECT MAX(rowid) AS n FROM earn_submissions WHERE epoch=?').get(epoch).n??0;
  const rows=db.prepare(`SELECT s.rowid AS seq,s.id,s.wallet,s.token_id AS tokenId,s.url,s.submitted_ms AS submittedAtMs,
    r.content_score AS contentScore,r.reason,r.reviewed_ms AS reviewedAtMs
    FROM earn_submissions s LEFT JOIN earn_reviews r ON s.id=r.submission_id WHERE s.epoch=? AND s.rowid>? AND s.rowid<=?
    AND r.submission_id IS ${state==='pending'?'NULL':'NOT NULL'} ORDER BY s.rowid LIMIT ?`)
    .all(epoch,previous?.last??0,ceiling,limit+1);
  const page=rows.slice(0,limit);
  return {mode:'local-operator',epoch,state,items:page.map(({seq,...post})=>post),
    nextCursor:rows.length>limit?Buffer.from(JSON.stringify({epoch,state,ceiling,last:page.at(-1).seq})).toString('base64url'):null};
}

export function workloadMetrics(db,{epoch,nowMs}) {
  nat(epoch,'epoch');nat(nowMs,'now');
  // Aggregate only. No wallet IDs, raw URLs, proof strings, IPs or private notes.
  const row=db.prepare(`SELECT COUNT(*) AS admitted,COUNT(r.submission_id) AS reviewed,
    COUNT(CASE WHEN r.content_score=0 THEN 1 END) AS rejected,
    MIN(CASE WHEN r.submission_id IS NULL THEN s.submitted_ms END) AS oldest_pending
    FROM earn_submissions s LEFT JOIN earn_reviews r ON r.submission_id=s.id WHERE s.epoch=?`).get(epoch);
  const board=db.prepare('SELECT finalized_ms,winners FROM earn_boards WHERE epoch=?').get(epoch);
  const allocations=db.prepare('SELECT token_id AS tokenId,day,budget,burn FROM earn_allocations WHERE epoch=? ORDER BY token_id,day').all(epoch);
  const from=epoch*DAY_MS,end=from+DAY_MS;
  const evidence=db.prepare(`SELECT COUNT(*) AS receipts,COUNT(CASE WHEN read_id IS NULL THEN 1 END) AS heldObservations
    FROM price_observations WHERE as_of_ms>=? AND as_of_ms<?`).get(from,end);
  return {epoch,capacity:capacityAt(db,epoch,nowMs),reviewed:row.reviewed,rejected:row.rejected,
    awaitingReview:row.admitted-row.reviewed,oldestAwaitingMs:row.oldest_pending===null?null:Math.max(0,nowMs-row.oldest_pending),
    boardStatus:board?'final':'pending',winners:board?JSON.parse(board.winners).length:null,
    evidence:{...evidence},allocations:allocations.map(a=>({...a,allocated:String(BigInt(a.budget)-BigInt(a.burn))}))};
}
