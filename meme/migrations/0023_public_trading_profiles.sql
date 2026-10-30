CREATE TABLE meme_trading_board_sources(board_id TEXT NOT NULL REFERENCES meme_trading_boards(id),fid INTEGER NOT NULL,source_id TEXT NOT NULL REFERENCES meme_trading_sources(id),PRIMARY KEY(board_id,fid));
CREATE INDEX meme_share_pinned_source ON meme_share_cards(kind,subject,window,fid,json_extract(payload,'$.sourceHash'),created_at DESC,id DESC);
CREATE TRIGGER meme_trading_board_scope_update BEFORE UPDATE ON meme_trading_board_sources BEGIN SELECT RAISE(ABORT,'Immutable public trading cohort');END;
CREATE TRIGGER meme_trading_board_scope_delete BEFORE DELETE ON meme_trading_board_sources BEGIN SELECT RAISE(ABORT,'Immutable public trading cohort');END;
