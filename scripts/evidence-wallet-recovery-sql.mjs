// Exact original claim/finish guards. Private recorded-turn publication only.
const tables={direct:"tenx_funding_scans",second:"tenx_second_hop_scans"};
export const recoveryClaimSql=Object.freeze(Object.fromEntries(Object.entries(tables).map(([hop,table])=>[hop,`INSERT OR IGNORE INTO tenx_funding_reads(signature,reader_version,expected_slot,is_recovery,job_id,address,source_evidence_hash,hop,wallet,anchor_key,checkpoint_hash,started_at,state)
    SELECT ?1,?2,?3,1,?4,?5,?6,?7,?8,?9,?10,?11,'reading'
    WHERE EXISTS(SELECT 1 FROM ${table} s WHERE address=?5 AND wallet=?8 AND anchor_signature=?9 AND payload_hash=?10
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.examined') WHERE json_extract(value,'$.signature')=?1 AND json_extract(value,'$.status')='unsupported')
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.pages') p, json_each(p.value,'$.rows') b
        WHERE json_extract(b.value,'$.signature')=?1 AND json_extract(b.value,'$.slot')=?3 AND json_extract(b.value,'$.blockTime')=?15))
      AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?4 AND lease_until>=?11)
      AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0 AND (retry_after IS NULL OR retry_after<=?11 OR last_error NOT LIKE 'rpc_%'))
      AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=?5 AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=?6)
      AND NOT EXISTS(SELECT 1 FROM tenx_wallet_transactions WHERE signature=?1)
      AND (SELECT COUNT(*) FROM tenx_funding_reads WHERE is_recovery=1 AND started_at>=?12)<?13
      AND (SELECT COUNT(*) FROM tenx_funding_reads WHERE is_recovery=1 AND job_id=?4)<?14
    RETURNING signature`])));
const admitted=table=>`SELECT 1 FROM tenx_funding_reads r WHERE r.signature=?1 AND r.reader_version=?2 AND r.job_id=?3 AND r.state='reading'
    AND r.expected_slot=?7 AND r.hop=?8 AND r.wallet=?9 AND r.anchor_key=?10 AND r.checkpoint_hash=?11
    AND EXISTS(SELECT 1 FROM tenx_wallet_control WHERE id=1 AND lease_owner=?3 AND lease_until>=?4)
    AND EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND paused=0)
    AND EXISTS(SELECT 1 FROM ${table} s WHERE address=r.address AND wallet=r.wallet AND anchor_signature=r.anchor_key AND payload_hash=r.checkpoint_hash
      AND EXISTS(SELECT 1 FROM json_each(s.payload,'$.pages') p,json_each(p.value,'$.rows') b WHERE json_extract(b.value,'$.signature')=?1 AND json_extract(b.value,'$.slot')=?7 AND json_extract(b.value,'$.blockTime')=?12))
    AND EXISTS(SELECT 1 FROM tenx_candidates WHERE address=r.address AND mode='live' AND json_extract(payload,'$.wallet_analysis.evidence_hash')=r.source_evidence_hash)`;
export const recoveryCacheSql=Object.freeze(Object.fromEntries(Object.entries(tables).map(([hop,table])=>[hop,`INSERT OR IGNORE INTO tenx_wallet_transactions(signature,payload_hash,payload,fetched_at)
    SELECT ?1,?5,?6,?4 WHERE EXISTS(${admitted(table)})`])));
export const recoveryFinishSql=Object.freeze(Object.fromEntries(Object.entries(tables).map(([hop,table])=>[hop,`UPDATE tenx_funding_reads SET state='finished',finished_at=?4,outcome=?5,payload_hash=?6
    WHERE signature=?1 AND reader_version=?2 AND job_id=?3 AND state='reading' AND EXISTS(${admitted(table)})
    AND (?6 IS NULL OR EXISTS(SELECT 1 FROM tenx_wallet_transactions WHERE signature=?1 AND payload_hash=?6))`])));
