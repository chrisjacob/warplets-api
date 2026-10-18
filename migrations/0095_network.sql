-- Network is an independent analytics namespace in the existing shared D1.
CREATE TABLE IF NOT EXISTS network_events (
  tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, block_number INTEGER NOT NULL,
  block_hash TEXT NOT NULL, event_at INTEGER NOT NULL, fid INTEGER NOT NULL CHECK(fid > 0),
  recipient TEXT NOT NULL, observed_at INTEGER NOT NULL,
  PRIMARY KEY(tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS network_events_fid ON network_events(fid, event_at);
CREATE INDEX IF NOT EXISTS network_events_block ON network_events(block_number);
CREATE TABLE IF NOT EXISTS network_profiles (
  fid INTEGER PRIMARY KEY, country TEXT, location_status TEXT NOT NULL,
  token_id TEXT, token_status TEXT NOT NULL, token_name TEXT, token_symbol TEXT,
  opt_in_status TEXT NOT NULL, observed_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'official-client', quality TEXT NOT NULL DEFAULT 'observed'
);
CREATE INDEX IF NOT EXISTS network_profiles_observed ON network_profiles(observed_at, fid);
CREATE TABLE IF NOT EXISTS network_candidates (fid INTEGER PRIMARY KEY, observed_at INTEGER NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS network_confirmed (fid INTEGER PRIMARY KEY, observed_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'official-client-opted-in');
CREATE TABLE IF NOT EXISTS network_profile_failures (fid INTEGER PRIMARY KEY, retry_after INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS network_sync (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_leases (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_budgets (
  day TEXT NOT NULL, provider TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, provider)
);
CREATE TABLE IF NOT EXISTS network_snapshots (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, day TEXT NOT NULL,
  complete INTEGER NOT NULL, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS network_snapshots_time ON network_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS network_snapshots_day ON network_snapshots(day, created_at DESC);
