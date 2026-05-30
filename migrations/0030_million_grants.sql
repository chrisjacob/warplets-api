CREATE TABLE IF NOT EXISTS million_grant_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_month TEXT NOT NULL,
  user_id INTEGER,
  user_fid INTEGER,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  build_answer TEXT NOT NULL,
  x_post_url TEXT,
  farcaster_post_url TEXT,
  status TEXT NOT NULL DEFAULT 'accepted',
  fraud_score REAL NOT NULL DEFAULT 0,
  fraud_flags TEXT NOT NULL DEFAULT '[]',
  recaptcha_score REAL,
  neynar_score REAL,
  cloudflare_threat_score INTEGER,
  ip_hash TEXT,
  created_on TEXT NOT NULL,
  updated_on TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_grant_applications_email_month
  ON million_grant_applications(email, grant_month);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_grant_applications_user_month
  ON million_grant_applications(user_id, grant_month)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_million_grant_applications_month_status_created
  ON million_grant_applications(grant_month, status, created_on DESC);

CREATE INDEX IF NOT EXISTS idx_million_grant_applications_ip_month
  ON million_grant_applications(ip_hash, grant_month);

CREATE TABLE IF NOT EXISTS million_grant_share_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  post_url TEXT NOT NULL,
  created_on TEXT NOT NULL,
  FOREIGN KEY (application_id) REFERENCES million_grant_applications(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_grant_share_posts_application_platform
  ON million_grant_share_posts(application_id, platform);

CREATE TABLE IF NOT EXISTS million_app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_on TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS million_ip_controls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL DEFAULT 'block',
  label TEXT,
  notes TEXT,
  created_on TEXT NOT NULL,
  updated_on TEXT NOT NULL
);

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'x_quote_url', '', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'x_quote_url');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'farcaster_quote_url', '', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'farcaster_quote_url');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'recaptcha_min_score', '0.5', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'recaptcha_min_score');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'neynar_min_score', '0.5', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'neynar_min_score');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'cloudflare_threat_score_flag', '10', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'cloudflare_threat_score_flag');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'same_ip_month_clean_limit', '3', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'same_ip_month_clean_limit');

INSERT INTO million_app_config (key, value, updated_on)
SELECT 'same_ip_hour_submit_limit', '20', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM million_app_config WHERE key = 'same_ip_hour_submit_limit');
