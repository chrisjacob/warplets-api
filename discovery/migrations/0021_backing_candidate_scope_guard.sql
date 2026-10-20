-- A candidate leaving the live inventory must not silently fall back to its opening snapshot.
CREATE TRIGGER tenx_backing_candidate_scope_exit BEFORE UPDATE OF mode,address ON tenx_candidates
WHEN OLD.mode='live' AND (NEW.mode<>'live' OR NEW.address<>OLD.address)
BEGIN
  UPDATE tenx_backing_runs SET history_limited=1
  WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=OLD.address);
END;
