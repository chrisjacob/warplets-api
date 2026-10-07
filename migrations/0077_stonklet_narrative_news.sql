CREATE TABLE IF NOT EXISTS stonklet_news_articles (
 id TEXT PRIMARY KEY, narrative_key TEXT NOT NULL, headline TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE,
 domain TEXT NOT NULL, publisher TEXT NOT NULL, published_at TEXT NOT NULL, discovered_at TEXT NOT NULL,
 priority INTEGER NOT NULL DEFAULT 0, source_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stonklet_news_articles_date ON stonklet_news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS stonklet_news_articles_narrative ON stonklet_news_articles(narrative_key);
CREATE TABLE IF NOT EXISTS stonklet_news_links (
 id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES stonklet_news_articles(id), pair_id TEXT NOT NULL,
 relation TEXT NOT NULL CHECK(relation IN ('direct','sector')), evidence TEXT NOT NULL, selected_at TEXT NOT NULL,
 published INTEGER NOT NULL DEFAULT 0, withdrawn_at TEXT, withdrawal_reason TEXT,
 UNIQUE(article_id,pair_id)
);
CREATE INDEX IF NOT EXISTS stonklet_news_pair ON stonklet_news_links(pair_id,published,withdrawn_at,article_id);
CREATE TABLE IF NOT EXISTS stonklet_news_sources (
 id TEXT PRIMARY KEY, etag TEXT, modified TEXT, checked_at TEXT, error TEXT, failures INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stonklet_news_jobs (
 hour TEXT NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL, accepted INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, error TEXT,
 PRIMARY KEY(hour,source_id)
);
CREATE INDEX IF NOT EXISTS stonklet_news_jobs_status ON stonklet_news_jobs(hour,status);
CREATE TABLE IF NOT EXISTS stonklet_news_runs (
 hour TEXT PRIMARY KEY, expected INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', evaluated_at TEXT NOT NULL
);
-- Preserve old share identities and provenance. No synthetic quote inputs in the new schema.
INSERT OR IGNORE INTO stonklet_news_articles
 SELECT 'legacy-'||id, lower(json_extract(thesis_json,'$.headline')), json_extract(thesis_json,'$.headline'),
 json_extract(thesis_json,'$.sources[0].url'),'',json_extract(thesis_json,'$.sources[0].publisher'),
 json_extract(thesis_json,'$.sources[0].publishedAt'),selected_at,0,json_extract(thesis_json,'$.sources[0]')
 FROM stonklet_spotlight_theses WHERE json_extract(thesis_json,'$.strategy')='trending-news-v3' AND json_extract(thesis_json,'$.headline') IS NOT NULL;
INSERT OR IGNORE INTO stonklet_news_links
 SELECT t.id,a.id,t.pair_id,'direct','Previously reviewed company announcement',t.selected_at,t.published,t.withdrawn_at,t.withdrawal_reason
 FROM stonklet_spotlight_theses t JOIN stonklet_news_articles a ON a.canonical_url=json_extract(t.thesis_json,'$.sources[0].url')
 WHERE json_extract(t.thesis_json,'$.strategy')='trending-news-v3';
UPDATE stonklet_spotlight_control SET mode=CASE WHEN mode='off' THEN 'off' ELSE 'shadow' END,
 strategy_version='narrative-news-v4',trial_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE strategy_version IS NULL OR strategy_version!='narrative-news-v4';
