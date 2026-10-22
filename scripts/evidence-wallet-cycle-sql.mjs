// Exact original cache-capable scheduler control writes; no source dispatch.
export const walletLeaseSql="UPDATE tenx_wallet_control SET lease_owner=?1,lease_until=?2 WHERE id=1 AND (lease_until IS NULL OR lease_until<?3) AND ((?4=1 AND last_error IS NULL) OR next_refresh_at IS NULL OR next_refresh_at<=?3) RETURNING id";
export const walletSpacingSql="UPDATE tenx_wallet_control SET next_refresh_at=?1 WHERE id=1 AND lease_owner=?2";
export const walletReleaseSql="UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1 WHERE id=1 AND lease_owner=?2";
export const walletFailureSql="UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,next_refresh_at=?1,last_error=?2 WHERE id=1 AND lease_owner=?3";
export const walletFailureRunSql="INSERT OR IGNORE INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)";
export const walletAttemptSql="INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) VALUES(?1,?2,?3) ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at";
