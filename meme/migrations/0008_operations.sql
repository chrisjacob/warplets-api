-- Additive only. Existing local-v1 settlements and evidence remain immutable.
CREATE TABLE meme_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('score','settle','prepare')),subject TEXT NOT NULL,payload TEXT NOT NULL,due_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('queued','running','done','blocked')),attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,retry_at INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at INTEGER NOT NULL,completed_at INTEGER);
CREATE INDEX meme_jobs_due ON meme_jobs(state,retry_at,due_at);
CREATE TABLE meme_round_preparations(round_id TEXT PRIMARY KEY REFERENCES meme_rounds(id),job_id TEXT NOT NULL UNIQUE REFERENCES meme_jobs(id),plan_hash TEXT NOT NULL);
CREATE TRIGGER meme_preparation_immutable BEFORE UPDATE ON meme_round_preparations BEGIN SELECT RAISE(ABORT,'Preparation receipts are immutable'); END;
CREATE TRIGGER meme_preparation_no_delete BEFORE DELETE ON meme_round_preparations BEGIN SELECT RAISE(ABORT,'Preparation receipts are immutable'); END;
CREATE TABLE meme_score_snapshots(id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES meme_rounds(id),as_of INTEGER NOT NULL,context TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('building','ready')),input_count INTEGER NOT NULL,result_hash TEXT,created_at INTEGER NOT NULL);
CREATE INDEX meme_score_round ON meme_score_snapshots(round_id,as_of DESC);
CREATE TABLE meme_score_inputs(snapshot_id TEXT NOT NULL REFERENCES meme_score_snapshots(id),fid INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(snapshot_id,fid));
CREATE TABLE meme_score_results(snapshot_id TEXT NOT NULL,fid INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,point_units INTEGER NOT NULL,candidate_id TEXT,first_valid_at INTEGER NOT NULL,holding_ready INTEGER NOT NULL CHECK(holding_ready IN(0,1)),PRIMARY KEY(snapshot_id,fid),FOREIGN KEY(snapshot_id,fid) REFERENCES meme_score_inputs(snapshot_id,fid));
CREATE INDEX meme_score_rank ON meme_score_results(snapshot_id,point_units DESC,first_valid_at,fid);
CREATE TABLE meme_score_heads(round_id TEXT PRIMARY KEY REFERENCES meme_rounds(id),snapshot_id TEXT NOT NULL REFERENCES meme_score_snapshots(id));
CREATE TABLE meme_score_hash_progress(snapshot_id TEXT PRIMARY KEY REFERENCES meme_score_snapshots(id),cursor INTEGER NOT NULL,count INTEGER NOT NULL,root_hash TEXT NOT NULL);
-- Index by wallet without scanning unrelated users' JSON histories for every score.
CREATE TABLE meme_ledger_wallet_index(event_id TEXT NOT NULL REFERENCES meme_ledger_events(id),campaign_id TEXT NOT NULL,wallet TEXT NOT NULL,event_at INTEGER NOT NULL,PRIMARY KEY(event_id,wallet));
INSERT INTO meme_ledger_wallet_index SELECT DISTINCT e.id,e.campaign_id,w.value,e.event_at FROM meme_ledger_events e,json_each(json_array(json_extract(e.payload,'$.wallet'),json_extract(e.payload,'$.from'),json_extract(e.payload,'$.to'))) w WHERE w.value IS NOT NULL;
CREATE INDEX meme_wallet_history ON meme_ledger_wallet_index(campaign_id,wallet,event_at,event_id);
CREATE TRIGGER meme_index_ledger_wallet AFTER INSERT ON meme_ledger_events BEGIN INSERT INTO meme_ledger_wallet_index SELECT DISTINCT NEW.id,NEW.campaign_id,w.value,NEW.event_at FROM json_each(json_array(json_extract(NEW.payload,'$.wallet'),json_extract(NEW.payload,'$.from'),json_extract(NEW.payload,'$.to'))) w WHERE w.value IS NOT NULL; END;
CREATE TRIGGER meme_score_input_immutable BEFORE UPDATE ON meme_score_inputs BEGIN SELECT RAISE(ABORT,'Score inputs are immutable'); END;
CREATE TRIGGER meme_score_input_no_delete BEFORE DELETE ON meme_score_inputs BEGIN SELECT RAISE(ABORT,'Score inputs are immutable'); END;
CREATE TRIGGER meme_score_result_immutable BEFORE UPDATE ON meme_score_results BEGIN SELECT RAISE(ABORT,'Score results are immutable'); END;
CREATE TRIGGER meme_score_result_no_delete BEFORE DELETE ON meme_score_results BEGIN SELECT RAISE(ABORT,'Score results are immutable'); END;
CREATE TRIGGER meme_score_manifest_immutable BEFORE UPDATE ON meme_score_snapshots WHEN OLD.state='ready' OR NEW.id!=OLD.id OR NEW.round_id!=OLD.round_id OR NEW.as_of!=OLD.as_of OR NEW.context!=OLD.context OR (NEW.input_count!=OLD.input_count AND EXISTS(SELECT 1 FROM meme_score_results WHERE snapshot_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Score manifest is immutable'); END;
