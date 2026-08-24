-- Full-Unicode Warpmoji matching, curation, delivery and monitoring.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS warpmoji_emoji_groups (
  canonical_emoji TEXT PRIMARY KEY,
  cldr_name TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  unicode_version TEXT NOT NULL DEFAULT '17.0',
  reviewed_at TEXT,
  reviewed_by_fid INTEGER,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warpmoji_emoji_aliases (
  alias TEXT PRIMARY KEY,
  canonical_emoji TEXT NOT NULL,
  codepoints TEXT NOT NULL,
  is_rgi INTEGER NOT NULL DEFAULT 1 CHECK (is_rgi IN (0, 1)),
  FOREIGN KEY (canonical_emoji) REFERENCES warpmoji_emoji_groups(canonical_emoji) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_warpmoji_alias_canonical ON warpmoji_emoji_aliases(canonical_emoji);

CREATE TABLE IF NOT EXISTS warpmoji_candidates (
  canonical_emoji TEXT NOT NULL,
  token_id INTEGER NOT NULL CHECK (token_id BETWEEN 1 AND 10000),
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  exact_score REAL NOT NULL DEFAULT 0,
  fts_score REAL NOT NULL DEFAULT 0,
  semantic_score REAL NOT NULL DEFAULT 0,
  hint_score REAL NOT NULL DEFAULT 0,
  conflict_penalty REAL NOT NULL DEFAULT 0,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'approved', 'rejected')),
  assignment TEXT NOT NULL DEFAULT 'primary' CHECK (assignment IN ('primary', 'secondary')),
  scoring_version TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_fid INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (canonical_emoji, token_id),
  FOREIGN KEY (canonical_emoji) REFERENCES warpmoji_emoji_groups(canonical_emoji) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_warpmoji_candidates_review ON warpmoji_candidates(status, canonical_emoji, score DESC);
CREATE INDEX IF NOT EXISTS idx_warpmoji_candidates_token ON warpmoji_candidates(token_id, assignment, score DESC);

CREATE TABLE IF NOT EXISTS warpmoji_rejections (
  canonical_emoji TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  score REAL NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  scoring_version TEXT NOT NULL,
  rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rejected_by_fid INTEGER,
  restored_at TEXT,
  PRIMARY KEY (canonical_emoji, token_id)
);

CREATE TABLE IF NOT EXISTS warpmoji_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  mode TEXT NOT NULL DEFAULT 'shadow' CHECK (mode IN ('disabled', 'shadow', 'live')),
  organic_author_score REAL NOT NULL DEFAULT 0.5,
  organic_user_24h INTEGER NOT NULL DEFAULT 1,
  organic_daily INTEGER NOT NULL DEFAULT 200,
  mention_user_24h INTEGER NOT NULL DEFAULT 10,
  mention_daily INTEGER NOT NULL DEFAULT 300,
  combined_daily INTEGER NOT NULL DEFAULT 500 CHECK (combined_daily BETWEEN 0 AND 900),
  queue_batch_size INTEGER NOT NULL DEFAULT 10,
  scoring_version TEXT NOT NULL DEFAULT 'warpmoji-v1',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_fid INTEGER
);
INSERT OR IGNORE INTO warpmoji_settings (singleton) VALUES (1);

CREATE TABLE IF NOT EXISTS warpmoji_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('farcaster', 'telegram', 'discord', 'api')),
  external_event_id TEXT NOT NULL,
  event_class TEXT NOT NULL,
  author_id TEXT,
  canonical_emoji TEXT,
  input_emoji TEXT,
  token_id INTEGER,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  author_score REAL,
  source_created_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_warpmoji_events_created ON warpmoji_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warpmoji_events_status ON warpmoji_events(status, rejection_reason);

CREATE TABLE IF NOT EXISTS warpmoji_jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('reply', 'like')),
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'sent', 'retry', 'failed', 'shadow')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES warpmoji_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_warpmoji_jobs_queue ON warpmoji_jobs(status, available_at);

CREATE TABLE IF NOT EXISTS warpmoji_recent_selections (
  canonical_emoji TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  selected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_warpmoji_recent_pool ON warpmoji_recent_selections(canonical_emoji, selected_at DESC);

CREATE TABLE IF NOT EXISTS warpmoji_opt_outs (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS warpmoji_webhook_shards (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('organic', 'mention')),
  alias_count INTEGER NOT NULL DEFAULT 0,
  regex_text TEXT,
  remote_webhook_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warpmoji_attribution_daily (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  trigger TEXT NOT NULL,
  canonical_emoji TEXT NOT NULL,
  token_id INTEGER NOT NULL,
  opens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, trigger, canonical_emoji, token_id)
);

CREATE TABLE IF NOT EXISTS warpmoji_admin_audit (
  id TEXT PRIMARY KEY,
  admin_fid INTEGER NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
