-- Financial read cursors bind to the existing monotonic source revision.
-- Unrelated source changes may conservatively expire a cursor; no cursor may
-- combine ownership, reveal, claims or farm events from different revisions.
CREATE INDEX vault_owner_observation_lookup ON vault_observations(asset_id,observed_ms DESC)
 WHERE kind IN ('bind','transfer');
CREATE TRIGGER financial_read_source_vault_assets_insert AFTER INSERT ON vault_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_assets_update AFTER UPDATE ON vault_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_assets_delete AFTER DELETE ON vault_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_manifests_insert AFTER INSERT ON vault_manifests BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_manifests_update AFTER UPDATE ON vault_manifests BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_manifests_delete AFTER DELETE ON vault_manifests BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_claim_totals_insert AFTER INSERT ON vault_claim_totals BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_claim_totals_update AFTER UPDATE ON vault_claim_totals BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_claim_totals_delete AFTER DELETE ON vault_claim_totals BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_observations_insert AFTER INSERT ON vault_observations BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_observations_update AFTER UPDATE ON vault_observations BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_vault_observations_delete AFTER DELETE ON vault_observations BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_collect_assets_insert AFTER INSERT ON collect_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_collect_assets_update AFTER UPDATE ON collect_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_collect_assets_delete AFTER DELETE ON collect_assets BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_farms_insert AFTER INSERT ON stake_fixture_farms BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_farms_update AFTER UPDATE ON stake_fixture_farms BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_farms_delete AFTER DELETE ON stake_fixture_farms BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_events_insert AFTER INSERT ON stake_fixture_events BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_events_update AFTER UPDATE ON stake_fixture_events BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
CREATE TRIGGER financial_read_source_stake_fixture_events_delete AFTER DELETE ON stake_fixture_events BEGIN UPDATE app_revisions SET revision=revision+1 WHERE name='source'; END;
