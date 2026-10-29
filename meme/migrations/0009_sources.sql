CREATE TABLE meme_source_runs(id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL REFERENCES meme_campaigns(id),wallet TEXT NOT NULL,provider TEXT NOT NULL CHECK(provider='helius'),from_at INTEGER NOT NULL,through_at INTEGER NOT NULL,cursor TEXT,state TEXT NOT NULL CHECK(state IN('collecting','ready','blocked')),pages INTEGER NOT NULL DEFAULT 0,root_hash TEXT NOT NULL,last_slot INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(campaign_id,wallet,through_at));
CREATE TABLE meme_source_pages(run_id TEXT NOT NULL REFERENCES meme_source_runs(id),page_index INTEGER NOT NULL,request_cursor TEXT NOT NULL,next_cursor TEXT,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(run_id,page_index),UNIQUE(run_id,request_cursor));
CREATE TABLE meme_source_receipts(run_id TEXT NOT NULL REFERENCES meme_source_runs(id),signature TEXT NOT NULL,slot INTEGER NOT NULL,at INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,PRIMARY KEY(run_id,signature));
CREATE INDEX meme_sources_coverage ON meme_source_runs(campaign_id,wallet,state,through_at);
CREATE TABLE meme_source_budgets(provider TEXT PRIMARY KEY,ceiling INTEGER NOT NULL CHECK(ceiling>=0),used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),approval TEXT NOT NULL);
-- These are NEW providers, with no authorized allowance. No implicit daily/monthly reset.
INSERT INTO meme_source_budgets VALUES('helius',0,0,'Unapproved: no requests authorized');
INSERT INTO meme_source_budgets VALUES('pyth',0,0,'Unapproved: no requests authorized');
CREATE TABLE meme_price_feeds(payment_mint TEXT PRIMARY KEY,feed_id TEXT NOT NULL UNIQUE,decimals INTEGER NOT NULL,max_age_seconds INTEGER NOT NULL,max_confidence_bps INTEGER NOT NULL,approval TEXT NOT NULL);
CREATE TABLE meme_verified_prices(evidence_hash TEXT PRIMARY KEY,payment_mint TEXT NOT NULL REFERENCES meme_price_feeds(payment_mint),at INTEGER NOT NULL,publish_at INTEGER NOT NULL,usd_micros TEXT NOT NULL,feed_id TEXT NOT NULL,payload TEXT NOT NULL,trust_model TEXT NOT NULL CHECK(trust_model='oracle-https'));
CREATE INDEX meme_price_time ON meme_verified_prices(payment_mint,at);
CREATE TABLE meme_source_corrections(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES meme_source_corrections(id),campaign_id TEXT NOT NULL REFERENCES meme_campaigns(id),reason TEXT NOT NULL,manifest_hash TEXT NOT NULL,effective_from INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('proposed','rejected','superseded')),actor TEXT NOT NULL,created_at INTEGER NOT NULL,resolution TEXT);
CREATE TRIGGER meme_source_page_immutable BEFORE UPDATE ON meme_source_pages BEGIN SELECT RAISE(ABORT,'Source pages are immutable'); END;
CREATE TRIGGER meme_source_page_no_delete BEFORE DELETE ON meme_source_pages BEGIN SELECT RAISE(ABORT,'Source pages are immutable'); END;
CREATE TRIGGER meme_source_receipt_immutable BEFORE UPDATE ON meme_source_receipts BEGIN SELECT RAISE(ABORT,'Source receipts are immutable'); END;
CREATE TRIGGER meme_source_receipt_no_delete BEFORE DELETE ON meme_source_receipts BEGIN SELECT RAISE(ABORT,'Source receipts are immutable'); END;
CREATE TRIGGER meme_verified_price_immutable BEFORE UPDATE ON meme_verified_prices BEGIN SELECT RAISE(ABORT,'Oracle evidence is immutable'); END;
CREATE TRIGGER meme_verified_price_no_delete BEFORE DELETE ON meme_verified_prices BEGIN SELECT RAISE(ABORT,'Oracle evidence is immutable'); END;
CREATE TRIGGER meme_source_no_rewind BEFORE UPDATE ON meme_source_runs WHEN OLD.state='ready' OR NEW.from_at!=OLD.from_at OR NEW.through_at!=OLD.through_at OR NEW.campaign_id!=OLD.campaign_id OR NEW.wallet!=OLD.wallet OR NEW.pages<OLD.pages OR NEW.last_slot<OLD.last_slot BEGIN SELECT RAISE(ABORT,'Source history cannot be rewritten'); END;
