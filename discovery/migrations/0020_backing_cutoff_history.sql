-- Prospective only: legacy openings and frozen hashes are untouched.
ALTER TABLE tenx_backing_runs ADD COLUMN admitted_at TEXT;
ALTER TABLE tenx_backing_runs ADD COLUMN history_limited INTEGER NOT NULL DEFAULT 0 CHECK(history_limited IN (0,1));
CREATE TABLE tenx_backing_candidate_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES tenx_backing_runs(id),
  address TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX tenx_backing_history_cutoff ON tenx_backing_candidate_history(run_id,address,sequence DESC);
CREATE TRIGGER tenx_backing_history_no_update BEFORE UPDATE ON tenx_backing_candidate_history
BEGIN SELECT RAISE(ABORT,'backing_history_immutable'); END;
CREATE TRIGGER tenx_backing_history_no_delete BEFORE DELETE ON tenx_backing_candidate_history
BEGIN SELECT RAISE(ABORT,'backing_history_immutable'); END;
-- Triggers retain the effective merged row in the same transaction as every writer.
CREATE TRIGGER tenx_backing_candidate_update AFTER UPDATE OF payload ON tenx_candidates
WHEN NEW.mode='live' AND NEW.payload IS NOT OLD.payload
BEGIN
  UPDATE tenx_backing_runs SET history_limited=1 WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=NEW.address)
    AND history_limited=0
    AND (SELECT payload FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id AND address=NEW.address ORDER BY sequence DESC LIMIT 1) IS NOT NEW.payload
    AND ((SELECT COUNT(*) FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id)>=200
      OR COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id),0)+length(CAST(NEW.payload AS BLOB))>600000);
  INSERT INTO tenx_backing_candidate_history(run_id,address,recorded_at,payload)
    SELECT id,NEW.address,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.payload FROM tenx_backing_runs
    WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=NEW.address) AND history_limited=0
      AND (SELECT payload FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id AND address=NEW.address ORDER BY sequence DESC LIMIT 1) IS NOT NEW.payload;
END;
CREATE TRIGGER tenx_backing_candidate_insert AFTER INSERT ON tenx_candidates
WHEN NEW.mode='live'
BEGIN
  UPDATE tenx_backing_runs SET history_limited=1 WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=NEW.address)
    AND history_limited=0
    AND (SELECT payload FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id AND address=NEW.address ORDER BY sequence DESC LIMIT 1) IS NOT NEW.payload
    AND ((SELECT COUNT(*) FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id)>=200
      OR COALESCE((SELECT SUM(length(CAST(payload AS BLOB))) FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id),0)+length(CAST(NEW.payload AS BLOB))>600000);
  INSERT INTO tenx_backing_candidate_history(run_id,address,recorded_at,payload)
    SELECT id,NEW.address,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.payload FROM tenx_backing_runs
    WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=NEW.address) AND history_limited=0
      AND (SELECT payload FROM tenx_backing_candidate_history WHERE run_id=tenx_backing_runs.id AND address=NEW.address ORDER BY sequence DESC LIMIT 1) IS NOT NEW.payload;
END;
-- Losing a candidate during the window is a coverage failure, never a clean baseline.
CREATE TRIGGER tenx_backing_candidate_delete BEFORE DELETE ON tenx_candidates WHEN OLD.mode='live'
BEGIN
  UPDATE tenx_backing_runs SET history_limited=1 WHERE state='open' AND json_extract(opening,'$.cutoff_evidence_version')='candidate-journal-v1'
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')>=created_at
    AND strftime('%Y-%m-%dT%H:%M:%fZ','now')<=ends_at
    AND EXISTS(SELECT 1 FROM json_each(opening,'$.candidates') WHERE json_extract(value,'$.address')=OLD.address);
END;
