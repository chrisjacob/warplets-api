ALTER TABLE warpmoji_jobs ADD COLUMN last_http_status INTEGER;
ALTER TABLE warpmoji_jobs ADD COLUMN last_latency_ms INTEGER;
ALTER TABLE warpmoji_jobs ADD COLUMN estimated_credits INTEGER NOT NULL DEFAULT 0;
