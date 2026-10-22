// Exact original cached-funding SQL only. No arbitrary control/quota writes.
export const cachedCheckpointSql=`UPDATE tenx_funding_scans SET payload=?1,payload_hash=?2,attempted_at=?3
      WHERE address=?4 AND wallet=?5 AND anchor_signature=?6 AND payload_hash=?7
      AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?4 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?8)
      AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?9 AND lease_until>?3)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`;
const guard=`EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2)
    AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?3 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?4)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)`;
export const cachedFinishSql=[
  `INSERT INTO tenx_wallet_work(address,source_evidence_hash,payload,attempted_at) SELECT ?3,?4,?5,?2 WHERE ${guard}
      ON CONFLICT(address) DO UPDATE SET source_evidence_hash=excluded.source_evidence_hash,payload=excluded.payload,attempted_at=excluded.attempted_at`,
  `INSERT INTO tenx_wallet_runs(id,address,source_evidence_hash,kind,state,started_at,finished_at,rpc_calls,completed_windows,new_buyers,error_code)
      SELECT ?1,?3,?4,'funding','succeeded',?5,?2,0,?6,0,NULL WHERE ${guard}`,
  `INSERT INTO tenx_wallet_attempts(address,attempted_at,next_attempt_at) SELECT ?3,?5,?6 WHERE ${guard}
      ON CONFLICT(address) DO UPDATE SET attempted_at=excluded.attempted_at,next_attempt_at=excluded.next_attempt_at`,
  `UPDATE tenx_wallet_control SET lease_owner=NULL,lease_until=NULL,last_address=?3,next_refresh_at=?5 WHERE id=1 AND ${guard}`,
];
