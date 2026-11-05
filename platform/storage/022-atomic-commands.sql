-- Local application concurrency metadata; existing economic rows remain authoritative.
CREATE TABLE app_revisions (name TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>=0)) STRICT;
INSERT INTO app_revisions VALUES('earn',0),('source',0),('control',0);
CREATE TABLE app_operator_scopes (
 operator TEXT NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),PRIMARY KEY(operator,scope)
) STRICT;
CREATE TABLE app_command_receipts (
 operation_id TEXT PRIMARY KEY,principal_key TEXT NOT NULL,operation_kind TEXT NOT NULL,business_key TEXT NOT NULL,
 request_key TEXT NOT NULL,request_digest TEXT NOT NULL,expected_revisions TEXT NOT NULL,
 claim_nonce TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN ('staging','committed')),
 input_json TEXT NOT NULL,result_json TEXT NOT NULL,output_digest TEXT NOT NULL,result_ref TEXT NOT NULL,
 created_ms INTEGER NOT NULL,UNIQUE(principal_key,operation_kind,request_key),UNIQUE(operation_kind,business_key)
) STRICT;
CREATE TRIGGER app_receipt_retained BEFORE DELETE ON app_command_receipts BEGIN
 SELECT RAISE(ABORT,'Command receipts must be retained');
END;
CREATE TRIGGER app_receipt_immutable BEFORE UPDATE ON app_command_receipts WHEN OLD.state='committed' BEGIN
 SELECT RAISE(ABORT,'Committed receipt is immutable');
END;
CREATE TRIGGER app_receipt_mandatory_effects BEFORE UPDATE OF state ON app_command_receipts WHEN NEW.state='committed' BEGIN
 SELECT RAISE(ABORT,'Missing mandatory submission') WHERE NEW.operation_kind='earn.admit-submission.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_submissions s WHERE s.id=NEW.result_ref AND s.wallet=json_extract(NEW.input_json,'$.wallet')
   AND s.token_id=json_extract(NEW.input_json,'$.tokenId') AND s.url=json_extract(NEW.input_json,'$.url')
   AND s.epoch=json_extract(NEW.input_json,'$.epoch') AND s.request_key=NEW.request_key
   AND s.entry_read_id=json_extract(NEW.input_json,'$.entryReadId') AND s.submitted_ms=NEW.created_ms
   AND EXISTS(SELECT 1 FROM earn_admission_counts c WHERE c.epoch=s.epoch AND c.admitted=(SELECT COUNT(*) FROM earn_submissions counted WHERE counted.epoch=s.epoch))
 );
 SELECT RAISE(ABORT,'Missing mandatory review') WHERE NEW.operation_kind='earn.final-review.v1' AND NOT EXISTS(
  SELECT 1 FROM earn_reviews r WHERE r.submission_id=NEW.result_ref
   AND r.content_score=json_extract(NEW.input_json,'$.score') AND r.reason=json_extract(NEW.input_json,'$.reason')
   AND r.moderator=json_extract(NEW.input_json,'$.moderator') AND r.source_ref=json_extract(NEW.input_json,'$.sourceRef')
   AND r.reviewed_ms=NEW.created_ms
 );
 SELECT RAISE(ABORT,'Unknown guarded operation') WHERE NEW.operation_kind NOT IN ('earn.admit-submission.v1','earn.final-review.v1');
END;
CREATE TRIGGER app_revision_earn_submissions_insert AFTER INSERT ON earn_submissions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_submissions_update AFTER UPDATE ON earn_submissions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_submissions_delete AFTER DELETE ON earn_submissions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_reviews_insert AFTER INSERT ON earn_reviews BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_reviews_update AFTER UPDATE ON earn_reviews BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_reviews_delete AFTER DELETE ON earn_reviews BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_boards_insert AFTER INSERT ON earn_boards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_boards_update AFTER UPDATE ON earn_boards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_boards_delete AFTER DELETE ON earn_boards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_decisions_insert AFTER INSERT ON earn_decisions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_decisions_update AFTER UPDATE ON earn_decisions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_decisions_delete AFTER DELETE ON earn_decisions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_streaks_insert AFTER INSERT ON earn_streaks BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_streaks_update AFTER UPDATE ON earn_streaks BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_streaks_delete AFTER DELETE ON earn_streaks BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_allocations_insert AFTER INSERT ON earn_allocations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_allocations_update AFTER UPDATE ON earn_allocations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_allocations_delete AFTER DELETE ON earn_allocations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_awards_insert AFTER INSERT ON earn_awards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_awards_update AFTER UPDATE ON earn_awards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_awards_delete AFTER DELETE ON earn_awards BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='earn';
END;
CREATE TRIGGER app_revision_earn_fixture_campaigns_insert AFTER INSERT ON earn_fixture_campaigns BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_fixture_campaigns_update AFTER UPDATE ON earn_fixture_campaigns BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_fixture_campaigns_delete AFTER DELETE ON earn_fixture_campaigns BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_stake_reads_insert AFTER INSERT ON earn_stake_reads BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_stake_reads_update AFTER UPDATE ON earn_stake_reads BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_stake_reads_delete AFTER DELETE ON earn_stake_reads BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_sources_insert AFTER INSERT ON price_sources BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_sources_update AFTER UPDATE ON price_sources BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_sources_delete AFTER DELETE ON price_sources BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_observations_insert AFTER INSERT ON price_observations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_observations_update AFTER UPDATE ON price_observations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_price_observations_delete AFTER DELETE ON price_observations BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_owner_snapshots_insert AFTER INSERT ON earn_owner_snapshots BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_owner_snapshots_update AFTER UPDATE ON earn_owner_snapshots BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_owner_snapshots_delete AFTER DELETE ON earn_owner_snapshots BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_known_collections_insert AFTER INSERT ON earn_known_collections BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_known_collections_update AFTER UPDATE ON earn_known_collections BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_known_collections_delete AFTER DELETE ON earn_known_collections BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_catalog_insert AFTER INSERT ON earn_action_catalog BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_catalog_update AFTER UPDATE ON earn_action_catalog BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_catalog_delete AFTER DELETE ON earn_action_catalog BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_changes_insert AFTER INSERT ON earn_action_changes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_changes_update AFTER UPDATE ON earn_action_changes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_changes_delete AFTER DELETE ON earn_action_changes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_completions_insert AFTER INSERT ON earn_action_completions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_completions_update AFTER UPDATE ON earn_action_completions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_action_completions_delete AFTER DELETE ON earn_action_completions BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_enrollments_insert AFTER INSERT ON earn_position_enrollments BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_enrollments_update AFTER UPDATE ON earn_position_enrollments BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_enrollments_delete AFTER DELETE ON earn_position_enrollments BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_cutoffs_insert AFTER INSERT ON earn_position_cutoffs BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_cutoffs_update AFTER UPDATE ON earn_position_cutoffs BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_position_cutoffs_delete AFTER DELETE ON earn_position_cutoffs BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='source';
END;
CREATE TRIGGER app_revision_earn_workload_policies_insert AFTER INSERT ON earn_workload_policies BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_earn_workload_policies_update AFTER UPDATE ON earn_workload_policies BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_earn_workload_policies_delete AFTER DELETE ON earn_workload_policies BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_scope_log_insert AFTER INSERT ON ops_scope_log BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_scope_log_update AFTER UPDATE ON ops_scope_log BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_scope_log_delete AFTER DELETE ON ops_scope_log BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_usage_insert AFTER INSERT ON ops_usage BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_usage_update AFTER UPDATE ON ops_usage BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_usage_delete AFTER DELETE ON ops_usage BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_optional_spend_insert AFTER INSERT ON ops_optional_spend BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_optional_spend_update AFTER UPDATE ON ops_optional_spend BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_optional_spend_delete AFTER DELETE ON ops_optional_spend BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_config_audit_insert AFTER INSERT ON ops_config_audit BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_config_audit_update AFTER UPDATE ON ops_config_audit BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_ops_config_audit_delete AFTER DELETE ON ops_config_audit BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_app_operator_scopes_insert AFTER INSERT ON app_operator_scopes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_app_operator_scopes_update AFTER UPDATE ON app_operator_scopes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
CREATE TRIGGER app_revision_app_operator_scopes_delete AFTER DELETE ON app_operator_scopes BEGIN
 UPDATE app_revisions SET revision=revision+1 WHERE name='control';
END;
