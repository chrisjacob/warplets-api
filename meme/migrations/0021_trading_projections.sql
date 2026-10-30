CREATE TABLE meme_trading_projections(source_id TEXT NOT NULL REFERENCES meme_trading_sources(id),as_of INTEGER NOT NULL,window TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source_id,window));
CREATE TABLE meme_trading_wallet_scope(source_id TEXT NOT NULL REFERENCES meme_trading_sources(id),wallet TEXT NOT NULL,PRIMARY KEY(source_id,wallet));
CREATE TRIGGER meme_trading_projection_update BEFORE UPDATE ON meme_trading_projections BEGIN SELECT RAISE(ABORT,'Immutable trader projection');END;
CREATE TRIGGER meme_trading_projection_delete BEFORE DELETE ON meme_trading_projections BEGIN SELECT RAISE(ABORT,'Immutable trader projection');END;
CREATE TRIGGER meme_trading_wallet_scope_update BEFORE UPDATE ON meme_trading_wallet_scope BEGIN SELECT RAISE(ABORT,'Immutable trader scope');END;
CREATE TRIGGER meme_trading_wallet_scope_delete BEFORE DELETE ON meme_trading_wallet_scope BEGIN SELECT RAISE(ABORT,'Immutable trader scope');END;
