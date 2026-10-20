-- Local 10X identity is independent of Warplets/Farcaster and confers no voting rights.
CREATE TABLE tenx_identities (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE tenx_identity_wallets (
  address TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES tenx_identities(id),
  linked_at TEXT NOT NULL
);
CREATE INDEX tenx_identity_wallet_owner ON tenx_identity_wallets(identity_id);
CREATE TABLE tenx_identity_sessions (
  token_hash TEXT PRIMARY KEY,
  identity_id TEXT REFERENCES tenx_identities(id),
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX tenx_identity_session_owner ON tenx_identity_sessions(identity_id);
CREATE TABLE tenx_identity_challenges (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL REFERENCES tenx_identity_sessions(token_hash),
  address TEXT NOT NULL,
  intent TEXT NOT NULL CHECK(intent IN ('login','link','unlink')),
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_by TEXT,
  consumed_at TEXT
);
CREATE INDEX tenx_identity_challenge_time ON tenx_identity_challenges(issued_at);
CREATE INDEX tenx_identity_challenge_session ON tenx_identity_challenges(session_hash,issued_at);
CREATE TABLE tenx_identity_audit (
  id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES tenx_identities(id),
  address TEXT,
  action TEXT NOT NULL,
  challenge_id TEXT,
  message_hash TEXT,
  signature_hash TEXT,
  created_at TEXT NOT NULL
);
