CREATE TABLE collect_inventories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('genesis','season')),
  tranche INTEGER UNIQUE CHECK(tranche IS NULL OR tranche BETWEEN 1 AND 10),
  season_start INTEGER,
  season_month TEXT UNIQUE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  origin_digest TEXT NOT NULL
) STRICT;

CREATE TABLE collect_snapshots (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES collect_inventories(id),
  stage_id TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  evidence_ref TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  UNIQUE(inventory_id,stage_id)
) STRICT;

CREATE TABLE collect_assets (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES collect_inventories(id),
  owner TEXT NOT NULL,
  bind_ms INTEGER NOT NULL,
  observed_ms INTEGER NOT NULL,
  reveal_ms INTEGER,
  slot TEXT NOT NULL,
  asset TEXT NOT NULL,
  UNIQUE(inventory_id,slot)
) STRICT;
CREATE INDEX collect_owner_assets ON collect_assets(owner,id);

CREATE TABLE collect_operations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('mint','upgrade','visual')),
  inventory_id TEXT NOT NULL REFERENCES collect_inventories(id),
  owner TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  commitment TEXT NOT NULL UNIQUE,
  created_ms INTEGER NOT NULL,
  operation TEXT NOT NULL,
  settled_ms INTEGER,
  proof_id TEXT UNIQUE,
  evidence_digest TEXT,
  receipt TEXT,
  UNIQUE(owner,request_key)
) STRICT;
CREATE INDEX collect_owner_operations ON collect_operations(owner,id);

CREATE TABLE collect_observations (
  source_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES collect_assets(id),
  event_kind TEXT NOT NULL,
  observed_ms INTEGER NOT NULL,
  digest TEXT NOT NULL
) STRICT;
CREATE INDEX collect_observed_asset_time ON collect_observations(asset_id,observed_ms);
