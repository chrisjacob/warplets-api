-- A consumed nonce may issue at most one session across concurrent Worker isolates.
CREATE TABLE edge_proof_consumptions (
 nonce TEXT PRIMARY KEY REFERENCES auth_challenges(nonce) ON DELETE CASCADE,
 session_hash TEXT UNIQUE NOT NULL
) STRICT;
CREATE TABLE manifest_catalog (
 byte_digest TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, size_bytes INTEGER NOT NULL,
 kind TEXT NOT NULL, recorded_ms INTEGER NOT NULL
) STRICT;
