-- Isolated recovery targets start locked before the first imported row.
-- Only named recovery batches temporarily set a nonce, write, then clear it
-- in one transaction. Ordinary handlers cannot access that private seam.
CREATE TABLE app_recovery_state (
 id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('live','public','private')),
 status TEXT NOT NULL CHECK(status IN ('live','restoring','ready','held')),generation TEXT NOT NULL,
 active_restore_id TEXT,inventory_digest TEXT,source_commit TEXT,schema_fingerprint TEXT,write_nonce TEXT,
 CHECK(write_nonce IS NULL OR status='restoring')
) STRICT;
INSERT INTO app_recovery_state VALUES(1,'live','live','initial-local',NULL,NULL,NULL,NULL,NULL);
CREATE TABLE app_recovery_runs (
 id TEXT PRIMARY KEY,mode TEXT NOT NULL CHECK(mode IN ('public','private')),inventory_digest TEXT NOT NULL UNIQUE,
 source_commit TEXT,schema_fingerprint TEXT,state TEXT NOT NULL CHECK(state IN ('restoring','ready','held')),
 created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,checkpoint_json TEXT NOT NULL DEFAULT '{}',report_json TEXT
) STRICT;
CREATE TABLE app_recovery_pages (
 restore_id TEXT NOT NULL REFERENCES app_recovery_runs(id),page_key TEXT NOT NULL,byte_digest TEXT NOT NULL,
 table_name TEXT NOT NULL,row_count INTEGER NOT NULL CHECK(row_count>=0),result_digest TEXT NOT NULL,created_ms INTEGER NOT NULL,
 PRIMARY KEY(restore_id,page_key)
) STRICT;
CREATE TRIGGER app_recovery_no_mode_escape BEFORE UPDATE ON app_recovery_state WHEN
 (OLD.mode<>'live' AND NEW.mode<>OLD.mode) OR (NEW.status='live' AND NEW.mode<>'live')
 BEGIN SELECT RAISE(ABORT,'Recovery targets cannot change recovery mode'); END;
CREATE TRIGGER app_recovery_ready_checkpoint BEFORE UPDATE ON app_recovery_state WHEN NEW.status='ready' BEGIN
 SELECT RAISE(ABORT,'Recovery ready requires a verified checkpoint') WHERE NEW.write_nonce IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM app_recovery_runs r WHERE r.id=NEW.active_restore_id AND r.inventory_digest=NEW.inventory_digest
   AND r.mode=NEW.mode AND r.state='ready' AND r.report_json IS NOT NULL);
END;
CREATE TRIGGER app_recovery_state_no_delete BEFORE DELETE ON app_recovery_state BEGIN SELECT RAISE(ABORT,'Retain recovery isolation state'); END;
CREATE TRIGGER app_recovery_page_identity BEFORE UPDATE ON app_recovery_pages BEGIN SELECT RAISE(ABORT,'Recovery page receipts are immutable'); END;
CREATE TRIGGER app_recovery_page_no_delete BEFORE DELETE ON app_recovery_pages BEGIN SELECT RAISE(ABORT,'Retain recovery page receipts'); END;
CREATE TRIGGER recovery_guard_app_artifact_publications_insert BEFORE INSERT ON app_artifact_publications
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_artifact_publications_update BEFORE UPDATE ON app_artifact_publications
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_artifact_publications_delete BEFORE DELETE ON app_artifact_publications
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_command_receipts_insert BEFORE INSERT ON app_command_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_command_receipts_update BEFORE UPDATE ON app_command_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_command_receipts_delete BEFORE DELETE ON app_command_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_complete_inputs_insert BEFORE INSERT ON app_complete_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_complete_inputs_update BEFORE UPDATE ON app_complete_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_complete_inputs_delete BEFORE DELETE ON app_complete_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_freezes_insert BEFORE INSERT ON app_epoch_freezes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_freezes_update BEFORE UPDATE ON app_epoch_freezes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_freezes_delete BEFORE DELETE ON app_epoch_freezes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_inputs_insert BEFORE INSERT ON app_epoch_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_inputs_update BEFORE UPDATE ON app_epoch_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_epoch_inputs_delete BEFORE DELETE ON app_epoch_inputs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_heads_insert BEFORE INSERT ON app_evidence_heads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_heads_update BEFORE UPDATE ON app_evidence_heads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_heads_delete BEFORE DELETE ON app_evidence_heads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_receipts_insert BEFORE INSERT ON app_evidence_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_receipts_update BEFORE UPDATE ON app_evidence_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_receipts_delete BEFORE DELETE ON app_evidence_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_sources_insert BEFORE INSERT ON app_evidence_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_sources_update BEFORE UPDATE ON app_evidence_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_evidence_sources_delete BEFORE DELETE ON app_evidence_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_execution_fences_insert BEFORE INSERT ON app_execution_fences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_execution_fences_update BEFORE UPDATE ON app_execution_fences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_execution_fences_delete BEFORE DELETE ON app_execution_fences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_attempts_insert BEFORE INSERT ON app_job_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_attempts_update BEFORE UPDATE ON app_job_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_attempts_delete BEFORE DELETE ON app_job_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_events_insert BEFORE INSERT ON app_job_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_events_update BEFORE UPDATE ON app_job_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_events_delete BEFORE DELETE ON app_job_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_outbox_insert BEFORE INSERT ON app_job_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_outbox_update BEFORE UPDATE ON app_job_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_job_outbox_delete BEFORE DELETE ON app_job_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_jobs_insert BEFORE INSERT ON app_jobs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_jobs_update BEFORE UPDATE ON app_jobs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_jobs_delete BEFORE DELETE ON app_jobs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_operator_scopes_insert BEFORE INSERT ON app_operator_scopes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_operator_scopes_update BEFORE UPDATE ON app_operator_scopes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_operator_scopes_delete BEFORE DELETE ON app_operator_scopes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_private_artifacts_insert BEFORE INSERT ON app_private_artifacts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_private_artifacts_update BEFORE UPDATE ON app_private_artifacts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_private_artifacts_delete BEFORE DELETE ON app_private_artifacts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_provider_attempts_insert BEFORE INSERT ON app_provider_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_provider_attempts_update BEFORE UPDATE ON app_provider_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_provider_attempts_delete BEFORE DELETE ON app_provider_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_revisions_insert BEFORE INSERT ON app_revisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_revisions_update BEFORE UPDATE ON app_revisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_revisions_delete BEFORE DELETE ON app_revisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_dependencies_insert BEFORE INSERT ON app_settlement_dependencies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_dependencies_update BEFORE UPDATE ON app_settlement_dependencies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_dependencies_delete BEFORE DELETE ON app_settlement_dependencies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_incidents_insert BEFORE INSERT ON app_settlement_incidents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_incidents_update BEFORE UPDATE ON app_settlement_incidents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_settlement_incidents_delete BEFORE DELETE ON app_settlement_incidents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_snapshot_attempts_insert BEFORE INSERT ON app_snapshot_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_snapshot_attempts_update BEFORE UPDATE ON app_snapshot_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_app_snapshot_attempts_delete BEFORE DELETE ON app_snapshot_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_auth_challenges_insert BEFORE INSERT ON auth_challenges
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_auth_challenges_update BEFORE UPDATE ON auth_challenges
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_auth_challenges_delete BEFORE DELETE ON auth_challenges
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_assets_insert BEFORE INSERT ON collect_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_assets_update BEFORE UPDATE ON collect_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_assets_delete BEFORE DELETE ON collect_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_inventories_insert BEFORE INSERT ON collect_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_inventories_update BEFORE UPDATE ON collect_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_inventories_delete BEFORE DELETE ON collect_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_level_history_insert BEFORE INSERT ON collect_level_history
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_level_history_update BEFORE UPDATE ON collect_level_history
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_level_history_delete BEFORE DELETE ON collect_level_history
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_observations_insert BEFORE INSERT ON collect_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_observations_update BEFORE UPDATE ON collect_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_observations_delete BEFORE DELETE ON collect_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_operations_insert BEFORE INSERT ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_operations_update BEFORE UPDATE ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_operations_delete BEFORE DELETE ON collect_operations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_snapshots_insert BEFORE INSERT ON collect_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_snapshots_update BEFORE UPDATE ON collect_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_collect_snapshots_delete BEFORE DELETE ON collect_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_catalog_insert BEFORE INSERT ON earn_action_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_catalog_update BEFORE UPDATE ON earn_action_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_catalog_delete BEFORE DELETE ON earn_action_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_changes_insert BEFORE INSERT ON earn_action_changes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_changes_update BEFORE UPDATE ON earn_action_changes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_changes_delete BEFORE DELETE ON earn_action_changes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_completions_insert BEFORE INSERT ON earn_action_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_completions_update BEFORE UPDATE ON earn_action_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_action_completions_delete BEFORE DELETE ON earn_action_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_admission_counts_insert BEFORE INSERT ON earn_admission_counts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_admission_counts_update BEFORE UPDATE ON earn_admission_counts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_admission_counts_delete BEFORE DELETE ON earn_admission_counts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_allocations_insert BEFORE INSERT ON earn_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_allocations_update BEFORE UPDATE ON earn_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_allocations_delete BEFORE DELETE ON earn_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_awards_insert BEFORE INSERT ON earn_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_awards_update BEFORE UPDATE ON earn_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_awards_delete BEFORE DELETE ON earn_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_boards_insert BEFORE INSERT ON earn_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_boards_update BEFORE UPDATE ON earn_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_boards_delete BEFORE DELETE ON earn_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_decisions_insert BEFORE INSERT ON earn_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_decisions_update BEFORE UPDATE ON earn_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_decisions_delete BEFORE DELETE ON earn_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_fixture_campaigns_insert BEFORE INSERT ON earn_fixture_campaigns
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_fixture_campaigns_update BEFORE UPDATE ON earn_fixture_campaigns
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_fixture_campaigns_delete BEFORE DELETE ON earn_fixture_campaigns
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_grants_insert BEFORE INSERT ON earn_issuer_grants
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_grants_update BEFORE UPDATE ON earn_issuer_grants
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_grants_delete BEFORE DELETE ON earn_issuer_grants
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_revocations_insert BEFORE INSERT ON earn_issuer_revocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_revocations_update BEFORE UPDATE ON earn_issuer_revocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_issuer_revocations_delete BEFORE DELETE ON earn_issuer_revocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_known_collections_insert BEFORE INSERT ON earn_known_collections
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_known_collections_update BEFORE UPDATE ON earn_known_collections
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_known_collections_delete BEFORE DELETE ON earn_known_collections
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_member_facts_insert BEFORE INSERT ON earn_member_facts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_member_facts_update BEFORE UPDATE ON earn_member_facts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_member_facts_delete BEFORE DELETE ON earn_member_facts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_assets_insert BEFORE INSERT ON earn_owner_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_assets_update BEFORE UPDATE ON earn_owner_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_assets_delete BEFORE DELETE ON earn_owner_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_snapshots_insert BEFORE INSERT ON earn_owner_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_snapshots_update BEFORE UPDATE ON earn_owner_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_owner_snapshots_delete BEFORE DELETE ON earn_owner_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_cutoffs_insert BEFORE INSERT ON earn_position_cutoffs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_cutoffs_update BEFORE UPDATE ON earn_position_cutoffs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_cutoffs_delete BEFORE DELETE ON earn_position_cutoffs
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_enrollments_insert BEFORE INSERT ON earn_position_enrollments
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_enrollments_update BEFORE UPDATE ON earn_position_enrollments
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_enrollments_delete BEFORE DELETE ON earn_position_enrollments
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_events_insert BEFORE INSERT ON earn_position_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_events_update BEFORE UPDATE ON earn_position_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_position_events_delete BEFORE DELETE ON earn_position_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_allocations_insert BEFORE INSERT ON earn_recovered_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_allocations_update BEFORE UPDATE ON earn_recovered_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_allocations_delete BEFORE DELETE ON earn_recovered_allocations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_awards_insert BEFORE INSERT ON earn_recovered_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_awards_update BEFORE UPDATE ON earn_recovered_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_awards_delete BEFORE DELETE ON earn_recovered_awards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_boards_insert BEFORE INSERT ON earn_recovered_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_boards_update BEFORE UPDATE ON earn_recovered_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_recovered_boards_delete BEFORE DELETE ON earn_recovered_boards
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_reviews_insert BEFORE INSERT ON earn_reviews
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_reviews_update BEFORE UPDATE ON earn_reviews
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_reviews_delete BEFORE DELETE ON earn_reviews
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_signed_completions_insert BEFORE INSERT ON earn_signed_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_signed_completions_update BEFORE UPDATE ON earn_signed_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_signed_completions_delete BEFORE DELETE ON earn_signed_completions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_stake_reads_insert BEFORE INSERT ON earn_stake_reads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_stake_reads_update BEFORE UPDATE ON earn_stake_reads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_stake_reads_delete BEFORE DELETE ON earn_stake_reads
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_streaks_insert BEFORE INSERT ON earn_streaks
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_streaks_update BEFORE UPDATE ON earn_streaks
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_streaks_delete BEFORE DELETE ON earn_streaks
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_submissions_insert BEFORE INSERT ON earn_submissions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_submissions_update BEFORE UPDATE ON earn_submissions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_submissions_delete BEFORE DELETE ON earn_submissions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_workload_policies_insert BEFORE INSERT ON earn_workload_policies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_workload_policies_update BEFORE UPDATE ON earn_workload_policies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_earn_workload_policies_delete BEFORE DELETE ON earn_workload_policies
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_edge_proof_consumptions_insert BEFORE INSERT ON edge_proof_consumptions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_edge_proof_consumptions_update BEFORE UPDATE ON edge_proof_consumptions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_edge_proof_consumptions_delete BEFORE DELETE ON edge_proof_consumptions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_inventories_insert BEFORE INSERT ON fair_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_inventories_update BEFORE UPDATE ON fair_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_inventories_delete BEFORE DELETE ON fair_inventories
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_requests_insert BEFORE INSERT ON fair_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_requests_update BEFORE UPDATE ON fair_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_requests_delete BEFORE DELETE ON fair_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_reserved_assets_insert BEFORE INSERT ON fair_reserved_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_reserved_assets_update BEFORE UPDATE ON fair_reserved_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_reserved_assets_delete BEFORE DELETE ON fair_reserved_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_results_insert BEFORE INSERT ON fair_results
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_results_update BEFORE UPDATE ON fair_results
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_fair_results_delete BEFORE DELETE ON fair_results
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_ballots_insert BEFORE INSERT ON genesis_ballots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_ballots_update BEFORE UPDATE ON genesis_ballots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_ballots_delete BEFORE DELETE ON genesis_ballots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_decisions_insert BEFORE INSERT ON genesis_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_decisions_update BEFORE UPDATE ON genesis_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_decisions_delete BEFORE DELETE ON genesis_decisions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_voters_insert BEFORE INSERT ON genesis_voters
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_voters_update BEFORE UPDATE ON genesis_voters
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_voters_delete BEFORE DELETE ON genesis_voters
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_votes_insert BEFORE INSERT ON genesis_votes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_votes_update BEFORE UPDATE ON genesis_votes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_genesis_votes_delete BEFORE DELETE ON genesis_votes
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_local_campaign_registry_insert BEFORE INSERT ON local_campaign_registry
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_local_campaign_registry_update BEFORE UPDATE ON local_campaign_registry
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_local_campaign_registry_delete BEFORE DELETE ON local_campaign_registry
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_manifest_catalog_insert BEFORE INSERT ON manifest_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_manifest_catalog_update BEFORE UPDATE ON manifest_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_manifest_catalog_delete BEFORE DELETE ON manifest_catalog
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_market_fixtures_insert BEFORE INSERT ON market_fixtures
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_market_fixtures_update BEFORE UPDATE ON market_fixtures
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_market_fixtures_delete BEFORE DELETE ON market_fixtures
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_consent_requests_insert BEFORE INSERT ON notice_consent_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_consent_requests_update BEFORE UPDATE ON notice_consent_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_consent_requests_delete BEFORE DELETE ON notice_consent_requests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_inbox_insert BEFORE INSERT ON notice_inbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_inbox_update BEFORE UPDATE ON notice_inbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_inbox_delete BEFORE DELETE ON notice_inbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_outbox_insert BEFORE INSERT ON notice_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_outbox_update BEFORE UPDATE ON notice_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_outbox_delete BEFORE DELETE ON notice_outbox
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_preferences_insert BEFORE INSERT ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_preferences_update BEFORE UPDATE ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_notice_preferences_delete BEFORE DELETE ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_config_audit_insert BEFORE INSERT ON ops_config_audit
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_config_audit_update BEFORE UPDATE ON ops_config_audit
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_config_audit_delete BEFORE DELETE ON ops_config_audit
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_optional_spend_insert BEFORE INSERT ON ops_optional_spend
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_optional_spend_update BEFORE UPDATE ON ops_optional_spend
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_optional_spend_delete BEFORE DELETE ON ops_optional_spend
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_scope_log_insert BEFORE INSERT ON ops_scope_log
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_scope_log_update BEFORE UPDATE ON ops_scope_log
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_scope_log_delete BEFORE DELETE ON ops_scope_log
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_usage_insert BEFORE INSERT ON ops_usage
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_usage_update BEFORE UPDATE ON ops_usage
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_ops_usage_delete BEFORE DELETE ON ops_usage
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_observations_insert BEFORE INSERT ON price_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_observations_update BEFORE UPDATE ON price_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_observations_delete BEFORE DELETE ON price_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_sources_insert BEFORE INSERT ON price_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_sources_update BEFORE UPDATE ON price_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_price_sources_delete BEFORE DELETE ON price_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_pool_snapshots_insert BEFORE INSERT ON quote_pool_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_pool_snapshots_update BEFORE UPDATE ON quote_pool_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_pool_snapshots_delete BEFORE DELETE ON quote_pool_snapshots
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_sources_insert BEFORE INSERT ON quote_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_sources_update BEFORE UPDATE ON quote_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_quote_sources_delete BEFORE DELETE ON quote_sources
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_request_limits_insert BEFORE INSERT ON request_limits
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_request_limits_update BEFORE UPDATE ON request_limits
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_request_limits_delete BEFORE DELETE ON request_limits
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_sessions_insert BEFORE INSERT ON sessions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_sessions_update BEFORE UPDATE ON sessions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_sessions_delete BEFORE DELETE ON sessions
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_events_insert BEFORE INSERT ON stake_fixture_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_events_update BEFORE UPDATE ON stake_fixture_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_events_delete BEFORE DELETE ON stake_fixture_events
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_farms_insert BEFORE INSERT ON stake_fixture_farms
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_farms_update BEFORE UPDATE ON stake_fixture_farms
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_stake_fixture_farms_delete BEFORE DELETE ON stake_fixture_farms
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_attempts_insert BEFORE INSERT ON tx_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_attempts_update BEFORE UPDATE ON tx_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_attempts_delete BEFORE DELETE ON tx_attempts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_intents_insert BEFORE INSERT ON tx_intents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_intents_update BEFORE UPDATE ON tx_intents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_intents_delete BEFORE DELETE ON tx_intents
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_receipts_insert BEFORE INSERT ON tx_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_receipts_update BEFORE UPDATE ON tx_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_receipts_delete BEFORE DELETE ON tx_receipts
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_request_keys_insert BEFORE INSERT ON tx_request_keys
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_request_keys_update BEFORE UPDATE ON tx_request_keys
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_tx_request_keys_delete BEFORE DELETE ON tx_request_keys
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_assets_insert BEFORE INSERT ON vault_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_assets_update BEFORE UPDATE ON vault_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_assets_delete BEFORE DELETE ON vault_assets
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_claim_totals_insert BEFORE INSERT ON vault_claim_totals
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_claim_totals_update BEFORE UPDATE ON vault_claim_totals
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_claim_totals_delete BEFORE DELETE ON vault_claim_totals
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_manifests_insert BEFORE INSERT ON vault_manifests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_manifests_update BEFORE UPDATE ON vault_manifests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_manifests_delete BEFORE DELETE ON vault_manifests
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_observations_insert BEFORE INSERT ON vault_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_observations_update BEFORE UPDATE ON vault_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
CREATE TRIGGER recovery_guard_vault_observations_delete BEFORE DELETE ON vault_observations
 WHEN EXISTS(SELECT 1 FROM app_recovery_state WHERE (mode='public' OR status IN ('restoring','held')) AND write_nonce IS NULL)
 BEGIN SELECT RAISE(ABORT,'Recovery target is mutation-disabled'); END;
