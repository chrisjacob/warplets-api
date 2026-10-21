-- Disposable presentation projection. Original evidence and frozen research stay separate.
CREATE TABLE tenx_score_source_revision (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision>=0 AND revision<9007199254740991)
);
INSERT INTO tenx_score_source_revision VALUES(1,0);
CREATE TABLE tenx_score_read_model (
  id INTEGER PRIMARY KEY CHECK(id=1),
  source_revision INTEGER NOT NULL,
  cutoff TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=1800000),
  CHECK(json_extract(payload,'$.version')='discovery-score-read-model-v1'),
  CHECK(json_extract(payload,'$.source_revision')=source_revision),
  CHECK(json_extract(payload,'$.cutoff')=cutoff),
  CHECK(json_array_length(payload,'$.candidates')<=500)
);
-- These are all mutable sources used by rankedDiscovery's current-inventory path.
-- Conservatively invalidate on every mutation, including same-timestamp edits.
CREATE TRIGGER tenx_score_candidates_insert AFTER INSERT ON tenx_candidates BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_candidates_update AFTER UPDATE ON tenx_candidates BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_candidates_delete AFTER DELETE ON tenx_candidates BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_market_insert AFTER INSERT ON tenx_market_history BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_market_update AFTER UPDATE ON tenx_market_history BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_market_delete AFTER DELETE ON tenx_market_history BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_expiry_insert AFTER INSERT ON tenx_candidate_expiry BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_expiry_update AFTER UPDATE ON tenx_candidate_expiry BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER tenx_score_expiry_delete AFTER DELETE ON tenx_candidate_expiry BEGIN UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1; END;
