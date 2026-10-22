// Original direct-funding scheduler statements; private recorded lane only.
export const directCatchupSql="INSERT INTO tenx_usage(provider,day,used) VALUES('wallet_catchup',?1,18) ON CONFLICT(provider,day) DO UPDATE SET used=used+18 WHERE used+18<=?2 RETURNING used";
export const directBackoffSql="UPDATE tenx_control SET last_error='rpc_rate_limited',retry_after=?1 WHERE id=1 AND (retry_after IS NULL OR retry_after<?1)";
export const directWorkSql="INSERT INTO tenx_wallet_work(address,source_evidence_hash,payload,attempted_at) VALUES(?1,?2,?3,?4) ON CONFLICT(address) DO UPDATE SET source_evidence_hash=excluded.source_evidence_hash,payload=excluded.payload,attempted_at=excluded.attempted_at";
export const directFinishSql="UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_address=?1,last_error=NULL,next_refresh_at=?3 WHERE id=1 AND lease_owner=?2";
export const directUnsupportedSql="INSERT OR IGNORE INTO tenx_funding_reads(signature,reader_version,expected_slot,is_recovery,started_at,finished_at,state,outcome)\n    VALUES(?,?,?,0,?,?,'finished',?)";
