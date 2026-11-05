CREATE TABLE vault_manifests(
 id TEXT PRIMARY KEY REFERENCES market_fixtures(id), activated_ms INTEGER NOT NULL, genesis_units TEXT NOT NULL,
 season_units TEXT NOT NULL, original_units TEXT NOT NULL, seasons TEXT NOT NULL, digest TEXT NOT NULL
) STRICT;
CREATE INDEX vault_manifest_order ON vault_manifests(activated_ms,id);
CREATE TABLE vault_assets(
 id TEXT PRIMARY KEY, slot_key TEXT UNIQUE NOT NULL, coords TEXT NOT NULL,
 owner TEXT NOT NULL, latest_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX vault_assets_by_owner ON vault_assets(owner,id);
CREATE TABLE vault_observations(
 event_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES vault_assets(id),
 kind TEXT NOT NULL, observed_ms INTEGER NOT NULL, body TEXT NOT NULL
) STRICT;
CREATE TABLE vault_claim_totals(
 asset_id TEXT NOT NULL REFERENCES vault_assets(id), launch_id TEXT NOT NULL REFERENCES vault_manifests(id),
 claimed TEXT NOT NULL, PRIMARY KEY(asset_id,launch_id)
) WITHOUT ROWID;
