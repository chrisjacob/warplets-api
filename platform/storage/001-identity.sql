CREATE TABLE auth_challenges (
  nonce TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL, message TEXT NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER
) STRICT;
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE request_limits (
  bucket TEXT PRIMARY KEY, resets_at INTEGER NOT NULL, hits INTEGER NOT NULL
) STRICT;
CREATE INDEX request_limits_expiry ON request_limits(resets_at);
