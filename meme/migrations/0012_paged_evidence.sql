CREATE INDEX meme_version_event_order ON meme_version_events(version_id,slot,signature,event_index);
CREATE TABLE meme_version_page_progress(
  version_id TEXT PRIMARY KEY REFERENCES meme_evidence_versions(id),
  phase TEXT NOT NULL CHECK(phase IN('hash','replay','sources','review')),
  cursor_slot INTEGER NOT NULL DEFAULT -1,
  cursor_signature TEXT NOT NULL DEFAULT '',
  cursor_index INTEGER NOT NULL DEFAULT -1,
  event_count INTEGER NOT NULL DEFAULT 0,
  event_root TEXT NOT NULL,
  wallet_index INTEGER NOT NULL DEFAULT 0,
  replay TEXT,
  source_id TEXT,
  source_signature TEXT NOT NULL DEFAULT '',
  source_root TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE meme_score_replay_progress(
  snapshot_id TEXT NOT NULL REFERENCES meme_score_snapshots(id),
  fid INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES meme_campaigns(id),
  checkpoint TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN(0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(snapshot_id,fid,campaign_id)
);
