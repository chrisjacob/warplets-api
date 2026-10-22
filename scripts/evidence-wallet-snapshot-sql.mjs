// Exact original snapshot publication and historical-review statements.
export const snapshotCandidateSql="UPDATE tenx_candidates SET payload=json_set(payload,'$.wallet_analysis',json(?1)) WHERE address=?2 AND mode='live'";
export const snapshotFinishSql="UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_success=?1,last_address=?2,last_error=NULL,next_refresh_at=?4 WHERE id=1 AND lease_owner=?3";
export const snapshotWorkSql="DELETE FROM tenx_wallet_work WHERE address=?1";
export const snapshotProfileSql="INSERT INTO tenx_wallet_profiles(address,wallet,payload_hash,payload,observed_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(address,wallet) DO UPDATE SET payload_hash=excluded.payload_hash,payload=excluded.payload,observed_at=excluded.observed_at";
export const snapshotReviewsSql="SELECT payload FROM (SELECT day,payload,ROW_NUMBER() OVER(PARTITION BY day ORDER BY created_at DESC,input_hash) AS position FROM tenx_reviews WHERE created_at>=?1) WHERE position=1 ORDER BY day DESC LIMIT 30";
