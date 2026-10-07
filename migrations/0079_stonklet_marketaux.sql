CREATE TABLE IF NOT EXISTS stonklet_marketaux_requests (
 id TEXT PRIMARY KEY,
 requested_at TEXT NOT NULL,
 pair_id TEXT NOT NULL,
 job_key TEXT,
 status TEXT NOT NULL DEFAULT 'reserved',
 response_json TEXT,
 error TEXT
);
CREATE INDEX IF NOT EXISTS stonklet_marketaux_requests_time ON stonklet_marketaux_requests(requested_at);
CREATE INDEX IF NOT EXISTS stonklet_marketaux_requests_job ON stonklet_marketaux_requests(job_key,pair_id);
CREATE TABLE IF NOT EXISTS stonklet_marketaux_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 blocked_until TEXT,
 reason TEXT
);
INSERT OR IGNORE INTO stonklet_marketaux_control(id) VALUES(1);
