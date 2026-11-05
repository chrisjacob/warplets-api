CREATE TABLE meme_share_cards(id TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,window TEXT NOT NULL,fid INTEGER NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE INDEX meme_share_lookup ON meme_share_cards(kind,subject,window,fid,created_at DESC,id DESC);
CREATE TABLE meme_share_images(card_id TEXT NOT NULL REFERENCES meme_share_cards(id),format TEXT NOT NULL CHECK(format IN('mini','og')),image_hash TEXT NOT NULL,png BLOB NOT NULL,PRIMARY KEY(card_id,format));
CREATE TRIGGER meme_share_immutable_update BEFORE UPDATE ON meme_share_cards BEGIN SELECT RAISE(ABORT,'Immutable share card');END;
CREATE TRIGGER meme_share_immutable_delete BEFORE DELETE ON meme_share_cards BEGIN SELECT RAISE(ABORT,'Immutable share card');END;
CREATE TRIGGER meme_share_image_immutable_update BEFORE UPDATE ON meme_share_images BEGIN SELECT RAISE(ABORT,'Immutable share image');END;
CREATE TRIGGER meme_share_image_immutable_delete BEFORE DELETE ON meme_share_images BEGIN SELECT RAISE(ABORT,'Immutable share image');END;
