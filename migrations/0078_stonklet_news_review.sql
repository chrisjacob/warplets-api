-- Bounded feed-level review inbox. Does not publish or alter archived narratives.
CREATE TABLE IF NOT EXISTS stonklet_news_review (
 source_id TEXT NOT NULL,
 canonical_url TEXT NOT NULL,
 headline TEXT NOT NULL,
 published_at TEXT NOT NULL,
 checked_at TEXT NOT NULL,
 reason TEXT NOT NULL,
 source_json TEXT NOT NULL,
 associations_json TEXT NOT NULL,
 PRIMARY KEY(source_id,canonical_url)
);
CREATE INDEX IF NOT EXISTS stonklet_news_review_reason ON stonklet_news_review(reason,checked_at DESC);
CREATE INDEX IF NOT EXISTS stonklet_news_review_expiry ON stonklet_news_review(published_at);
