-- Durable, read-optimized projection for the public subscriber avatar stack.
-- Visitor requests read only these D1 tables; Resend is reconciled separately.

CREATE TABLE IF NOT EXISTS email_social_proof_members (
  email TEXT PRIMARY KEY,
  farcaster_fid INTEGER,
  reconciled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_social_proof_members_fid
  ON email_social_proof_members(farcaster_fid)
  WHERE farcaster_fid IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_social_proof_profiles (
  fid INTEGER PRIMARY KEY,
  username TEXT,
  pfp_url TEXT NOT NULL,
  follower_count INTEGER,
  reconciled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_social_proof_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  reconciled_at TEXT,
  next_reconcile_at TEXT NOT NULL,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO email_social_proof_state (id, reconciled_at, next_reconcile_at, last_error, updated_at)
VALUES (1, NULL, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP);

-- Seed the projection from locally proven subscriptions. A scheduled Resend
-- reconciliation adds legacy contacts after deployment.
INSERT OR IGNORE INTO email_social_proof_members (email, farcaster_fid, reconciled_at, updated_at)
SELECT p.email, p.farcaster_fid, 'seed', p.updated_at
FROM email_identity_profiles p
WHERE EXISTS (SELECT 1 FROM email_identity_memberships m WHERE m.email = p.email);

INSERT OR IGNORE INTO email_social_proof_members (email, farcaster_fid, reconciled_at, updated_at)
SELECT lower(trim(e.email)), e.fid, 'seed', COALESCE(e.updated_at, e.verified_at, e.subscribed_at, CURRENT_TIMESTAMP)
FROM email_waitlist e
WHERE e.verified = 1 AND e.unsubscribed_at IS NULL;

INSERT OR REPLACE INTO email_social_proof_profiles (fid, username, pfp_url, follower_count, reconciled_at, updated_at)
SELECT DISTINCT
  u.fid,
  NULLIF(trim(u.username), ''),
  trim(u.pfp_url),
  u.follower_count,
  'seed',
  CURRENT_TIMESTAMP
FROM warplets_users u
WHERE u.pfp_url IS NOT NULL
  AND trim(u.pfp_url) <> ''
  AND EXISTS (SELECT 1 FROM email_social_proof_members m WHERE m.farcaster_fid = u.fid);
