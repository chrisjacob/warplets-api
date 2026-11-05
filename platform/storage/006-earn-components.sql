CREATE TABLE earn_action_catalog (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, verifier TEXT NOT NULL
) STRICT;
CREATE TABLE earn_action_changes (
  action_id TEXT NOT NULL REFERENCES earn_action_catalog, effective_epoch INTEGER NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), recorded_ms INTEGER NOT NULL,
  PRIMARY KEY(action_id,effective_epoch)
) STRICT;
CREATE TABLE earn_action_completions (
  wallet TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES earn_action_catalog, verified_ms INTEGER NOT NULL,
  verifier TEXT NOT NULL, source_ref TEXT NOT NULL, PRIMARY KEY(wallet,action_id)
) STRICT;
CREATE TABLE earn_known_collections (
  collection_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('genesis','season')),
  season_start_ms INTEGER
) STRICT;
CREATE TABLE earn_owner_snapshots (
  epoch INTEGER NOT NULL, wallet TEXT NOT NULL, assets TEXT NOT NULL, source_ref TEXT NOT NULL,
  PRIMARY KEY(epoch,wallet)
) STRICT;
CREATE TABLE earn_owner_assets (
  epoch INTEGER NOT NULL, wallet TEXT NOT NULL, asset_id TEXT NOT NULL,
  PRIMARY KEY(epoch,asset_id), FOREIGN KEY(epoch,wallet) REFERENCES earn_owner_snapshots
) STRICT;
CREATE TABLE earn_position_enrollments (
  wallet TEXT NOT NULL, token_id TEXT NOT NULL REFERENCES earn_fixture_campaigns, enrolled_ms INTEGER NOT NULL,
  PRIMARY KEY(wallet,token_id)
) STRICT;
CREATE TABLE earn_position_events (
  wallet TEXT NOT NULL, token_id TEXT NOT NULL, seq INTEGER NOT NULL, at_ms INTEGER NOT NULL,
  signature TEXT NOT NULL, instruction_idx INTEGER NOT NULL, kind TEXT NOT NULL, evidence TEXT NOT NULL,
  PRIMARY KEY(wallet,token_id,seq), UNIQUE(wallet,token_id,signature,instruction_idx),
  FOREIGN KEY(wallet,token_id) REFERENCES earn_position_enrollments
) STRICT;
CREATE UNIQUE INDEX earn_one_purchase_per_transaction ON earn_position_events(wallet,token_id,signature)
  WHERE kind='verified-buy-and-stake';
CREATE TABLE earn_position_cutoffs (
  epoch INTEGER NOT NULL, wallet TEXT NOT NULL, token_id TEXT NOT NULL, sequence INTEGER NOT NULL,
  credited TEXT NOT NULL, stake TEXT NOT NULL, numerator TEXT NOT NULL, denominator TEXT NOT NULL,
  flags TEXT NOT NULL, token_days INTEGER NOT NULL, source_ref TEXT NOT NULL,
  PRIMARY KEY(wallet,token_id,epoch), FOREIGN KEY(wallet,token_id) REFERENCES earn_position_enrollments
) STRICT;
