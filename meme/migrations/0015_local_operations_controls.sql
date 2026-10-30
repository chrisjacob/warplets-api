-- Local-preview safety controls. No financial activation or authority is granted.
CREATE TABLE meme_safety_controls(
  name TEXT PRIMARY KEY CHECK(name IN('serving','participation','operations','collection')),
  paused INTEGER NOT NULL CHECK(paused IN(0,1)),
  version INTEGER NOT NULL CHECK(version>=0),
  updated_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL
);
INSERT INTO meme_safety_controls VALUES
('serving',0,0,0,'Initial local default','migration'),
('participation',0,0,0,'Initial local default','migration'),
('operations',0,0,0,'Initial local default','migration'),
('collection',0,0,0,'Initial local default','migration');
CREATE TRIGGER meme_control_version BEFORE UPDATE ON meme_safety_controls
WHEN NEW.name!=OLD.name OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'Control changes require the next version'); END;
CREATE TRIGGER meme_control_no_delete BEFORE DELETE ON meme_safety_controls
BEGIN SELECT RAISE(ABORT,'Safety controls cannot be removed'); END;
CREATE TABLE meme_control_changes(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL REFERENCES meme_safety_controls(name),
  expected_version INTEGER NOT NULL,
  result_version INTEGER NOT NULL,
  paused INTEGER NOT NULL CHECK(paused IN(0,1)),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE TRIGGER meme_control_change_immutable BEFORE UPDATE ON meme_control_changes
BEGIN SELECT RAISE(ABORT,'Control receipts are immutable'); END;
CREATE TRIGGER meme_control_change_no_delete BEFORE DELETE ON meme_control_changes
BEGIN SELECT RAISE(ABORT,'Control receipts are immutable'); END;
CREATE TABLE meme_operations_heartbeat(
  id INTEGER PRIMARY KEY CHECK(id=1),
  run_token TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  running INTEGER NOT NULL CHECK(running IN(0,1)),
  outcome TEXT CHECK(outcome IN('idle','queued','done','retry','blocked','stale','paused','error'))
);
