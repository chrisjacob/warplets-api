CREATE TABLE meme_freeze_links(snapshot_id TEXT NOT NULL REFERENCES meme_ownership_snapshots(id),fid INTEGER NOT NULL,address TEXT NOT NULL,PRIMARY KEY(snapshot_id,fid,address));
