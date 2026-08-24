-- Canonical, email-confirmed identities and retryable Resend synchronization.

ALTER TABLE email_waitlist ADD COLUMN drop_reward_eligible INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS email_identity_profiles (
  email TEXT PRIMARY KEY,
  farcaster_fid INTEGER,
  farcaster_username TEXT,
  discord_user_id TEXT,
  discord_name TEXT,
  wallet TEXT,
  email_verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_identity_profiles_farcaster
  ON email_identity_profiles(farcaster_fid)
  WHERE farcaster_fid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_identity_profiles_discord
  ON email_identity_profiles(discord_user_id)
  WHERE discord_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_identity_claims (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  source TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  farcaster_fid INTEGER,
  farcaster_username TEXT,
  discord_user_id TEXT,
  discord_name TEXT,
  wallet TEXT,
  drop_reward_eligible INTEGER NOT NULL DEFAULT 0,
  resubscribe INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('pending', 'superseded', 'expired', 'confirmed_pending_sync', 'synced')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  synced_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_identity_claims_email_segment
  ON email_identity_claims(email, segment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_identity_claims_status_expiry
  ON email_identity_claims(status, expires_at);

CREATE TABLE IF NOT EXISTS email_identity_memberships (
  email TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  source TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (email, segment_id),
  FOREIGN KEY (email) REFERENCES email_identity_profiles(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_identity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  claim_id TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_identity_events_email_created
  ON email_identity_events(email, created_at DESC);

CREATE TABLE IF NOT EXISTS email_resend_outbox (
  claim_id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES email_identity_claims(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_resend_outbox_due
  ON email_resend_outbox(next_attempt_at, attempts);

-- Existing waitlist rows are trusted only when the legacy double-opt-in was
-- completed. Unverified subscriptions remain untouched and gain no identity.
INSERT OR IGNORE INTO email_identity_profiles (
  email, farcaster_fid, farcaster_username, discord_user_id, discord_name, wallet,
  email_verified_at, created_at, updated_at
)
SELECT
  lower(trim(e.email)),
  CASE WHEN e.fid > 0 THEN e.fid ELSE NULL END,
  CASE WHEN e.fid > 0 THEN COALESCE(NULLIF(trim(u.username), ''), NULLIF(trim(e.username), '')) ELSE NULL END,
  NULL,
  NULL,
  CASE WHEN e.fid > 0 THEN COALESCE(
    (SELECT lower(trim(a.wallet_address)) FROM app_identity_links a
      WHERE a.farcaster_fid = e.fid ORDER BY a.verified_at DESC LIMIT 1),
    NULLIF(lower(trim(u.primary_eth_address)), ''),
    (SELECT lower(trim(w.wallet)) FROM wallet_farcaster_links w
      WHERE w.fid = e.fid ORDER BY COALESCE(w.score, -1) DESC, w.wallet ASC LIMIT 1)
  ) ELSE NULL END,
  COALESCE(e.verified_at, e.updated_at, e.subscribed_at, CURRENT_TIMESTAMP),
  COALESCE(e.verified_at, e.updated_at, e.subscribed_at, CURRENT_TIMESTAMP),
  COALESCE(e.updated_at, e.verified_at, e.subscribed_at, CURRENT_TIMESTAMP)
FROM email_waitlist e
LEFT JOIN warplets_users u ON u.fid = e.fid
WHERE e.verified = 1;

INSERT OR IGNORE INTO email_identity_memberships (
  email, segment_id, source, confirmed_at, updated_at
)
SELECT
  lower(trim(e.email)),
  'e52bdc31-4f3c-4ec6-a623-9bc3977042e2',
  'legacy_drop_confirmed',
  COALESCE(e.verified_at, e.updated_at, e.subscribed_at, CURRENT_TIMESTAMP),
  COALESCE(e.updated_at, e.verified_at, e.subscribed_at, CURRENT_TIMESTAMP)
FROM email_waitlist e
WHERE e.verified = 1;
