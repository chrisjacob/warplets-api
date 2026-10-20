import { hashJson } from "./solana";
import type { Transaction } from "./rpc";
import { INBOX_RECOVERY_DAILY_LIMIT, INBOX_RECOVERY_PER_TURN, InboxRecoveryResponse, TRANSACTION_READER_VERSION } from "./inbox-recovery-model";

export type InboxEntry={signature:string;slot:number;processed_at:string|null;result:string|null};
const startOfDay=(now:Date)=>`${now.toISOString().slice(0,10)}T00:00:00.000Z`;
export async function recoveryCandidates(db:D1Database,now:Date):Promise<InboxEntry[]> {
  const rows=await db.prepare(`SELECT signature,slot,processed_at,result FROM tenx_pending_signatures p
    WHERE result='unsupported_transaction_version' AND processed_at IS NOT NULL AND processed_at<=?1
      AND queued_at>=?2 AND queued_at<=?1 AND NOT EXISTS(SELECT 1 FROM tenx_inbox_reads r WHERE r.signature=p.signature AND r.reader_version=?3)
      AND (SELECT COUNT(*) FROM tenx_inbox_reads WHERE is_recovery=1 AND started_at>=?4)<?5
    ORDER BY slot DESC,signature LIMIT ?6`).bind(now.toISOString(),new Date(now.getTime()-86400000).toISOString(),TRANSACTION_READER_VERSION,startOfDay(now),INBOX_RECOVERY_DAILY_LIMIT,INBOX_RECOVERY_PER_TURN).all<InboxEntry>();
  return rows.results;
}
// Reserve before the provider request. Duplicate delivery, crashes and racing
// workers cannot purchase a second format-upgrade read for this signature.
export async function claimRecovery(db:D1Database,row:InboxEntry,job:string,now:Date):Promise<boolean> {
  const saved=await db.prepare(`INSERT OR IGNORE INTO tenx_inbox_reads(signature,reader_version,job_id,is_recovery,expected_slot,prior_result,prior_processed_at,started_at,state)
    SELECT signature,?1,?2,1,slot,result,processed_at,?3,'reading' FROM tenx_pending_signatures p
    WHERE signature=?4 AND slot=?5 AND result='unsupported_transaction_version' AND processed_at=?6
      AND queued_at>=?7 AND queued_at<=?3 AND processed_at<=?3
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?2 AND paused=0)
      AND (SELECT COUNT(*) FROM tenx_inbox_reads WHERE is_recovery=1 AND started_at>=?8)<?9
      AND (SELECT COUNT(*) FROM tenx_inbox_reads WHERE is_recovery=1 AND job_id=?2)<?10
    RETURNING signature`).bind(TRANSACTION_READER_VERSION,job,now.toISOString(),row.signature,row.slot,row.processed_at,new Date(now.getTime()-86400000).toISOString(),startOfDay(now),INBOX_RECOVERY_DAILY_LIMIT,INBOX_RECOVERY_PER_TURN).first();
  return Boolean(saved);
}
export async function finishRecovery(db:D1Database,row:InboxEntry,job:string,outcome:string,tx:Transaction|null,now:Date):Promise<void> {
  const at=now.toISOString(),hash=tx?await hashJson(tx):null;
  // Preserve the old rejection in the read receipt while atomically updating
  // the mutable inbox projection. Losing the lease leaves a visible reading
  // receipt, not a certified success or an automatic repeat request.
  await db.batch([
    db.prepare(`UPDATE tenx_pending_signatures SET processed_at=?1,result=?2 WHERE signature=?3 AND slot=?4 AND processed_at=?5 AND result='unsupported_transaction_version'
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?6)
      AND EXISTS(SELECT 1 FROM tenx_inbox_reads WHERE signature=?3 AND reader_version=?7 AND job_id=?6 AND state='reading')`).bind(at,outcome,row.signature,row.slot,row.processed_at,job,TRANSACTION_READER_VERSION),
    db.prepare(`UPDATE tenx_inbox_reads SET state='finished',finished_at=?1,outcome=?2,payload_hash=?3 WHERE signature=?4 AND reader_version=?5 AND job_id=?6 AND state='reading'
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?6)
      AND EXISTS(SELECT 1 FROM tenx_pending_signatures WHERE signature=?4 AND slot=?7 AND processed_at=?1 AND result=?2)`).bind(at,outcome,hash,row.signature,TRANSACTION_READER_VERSION,job,row.slot),
  ]);
}
export async function recordUnsupportedRead(db:D1Database,row:InboxEntry,job:string,outcome:string,now:Date):Promise<void> {
  const at=now.toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO tenx_inbox_reads(signature,reader_version,job_id,is_recovery,expected_slot,prior_result,prior_processed_at,started_at,finished_at,state,outcome)
      SELECT signature,?1,?2,0,slot,result,processed_at,?3,?3,'finished',?4 FROM tenx_pending_signatures WHERE signature=?5
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?2)`).bind(TRANSACTION_READER_VERSION,job,at,outcome,row.signature),
    db.prepare("UPDATE tenx_pending_signatures SET processed_at=?1,result=?2 WHERE signature=?3 AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?4)").bind(at,outcome,row.signature,job),
  ]);
}
export async function inboxRecoveryStatus(db:D1Database,now=new Date()) {
  const at=now.toISOString(),cutoff=new Date(now.getTime()-86400000).toISOString();
  const counts=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM tenx_inbox_reads WHERE is_recovery=1 AND started_at>=?1) AS used_today,
    (SELECT COUNT(*) FROM tenx_pending_signatures p WHERE result='unsupported_transaction_version' AND processed_at IS NOT NULL AND processed_at<=?2 AND queued_at>=?3 AND queued_at<=?2
      AND NOT EXISTS(SELECT 1 FROM tenx_inbox_reads WHERE signature=p.signature AND reader_version=?4)) AS pending_recent,
    (SELECT COUNT(*) FROM tenx_pending_signatures WHERE result='unsupported_transaction_version' AND queued_at<?3) AS older_unsupported`).bind(startOfDay(now),at,cutoff,TRANSACTION_READER_VERSION).first<{used_today:number;pending_recent:number;older_unsupported:number}>();
  const recent=await db.prepare("SELECT signature,reader_version,expected_slot,prior_processed_at,started_at,finished_at,state,outcome,payload_hash FROM tenx_inbox_reads WHERE is_recovery=1 AND started_at<=?1 ORDER BY started_at DESC,signature LIMIT 10").bind(at).all();
  return InboxRecoveryResponse.shape.data.parse({at,reader_version:TRANSACTION_READER_VERSION,daily_limit:INBOX_RECOVERY_DAILY_LIMIT,per_turn_limit:INBOX_RECOVERY_PER_TURN,...counts,remaining_today:Math.max(0,INBOX_RECOVERY_DAILY_LIMIT-(counts?.used_today??0)),recent:recent.results,provider_requests:0,evidence_gates_changed:false});
}
