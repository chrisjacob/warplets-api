-- Append obligations in the same transaction as the immutable source decision.
-- Earlier accepted receipts remain replayable without retroactive mutation.
CREATE TABLE app_settlement_dependencies (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,dependency TEXT NOT NULL,digest TEXT NOT NULL,ready_ms INTEGER NOT NULL,
 UNIQUE(dependency,digest)
) STRICT;
CREATE TRIGGER app_settlement_dependencies_no_update BEFORE UPDATE ON app_settlement_dependencies
 BEGIN SELECT RAISE(ABORT,'Settlement dependency evidence is immutable'); END;
CREATE TRIGGER app_settlement_dependencies_no_delete BEFORE DELETE ON app_settlement_dependencies
 BEGIN SELECT RAISE(ABORT,'Retain settlement dependency evidence'); END;
ALTER TABLE app_jobs ADD COLUMN dependency_seq INTEGER NOT NULL DEFAULT 0;
CREATE INDEX app_settlement_dependency_sequence ON app_settlement_dependencies(dependency,sequence);
CREATE INDEX app_jobs_owner_ready ON app_jobs(principal,state,ready_ms,id);
CREATE INDEX app_job_outbox_owner_pending ON app_job_outbox(json_extract(command_json,'$.principal.id'),source_key) WHERE job_id IS NULL;
CREATE TRIGGER app_settlement_mandatory_outbox BEFORE UPDATE OF state ON app_command_receipts
 WHEN NEW.state='committed' AND NEW.operation_kind IN ('earn.seal-input.v1','earn.commit-board.v1','earn.commit-allocation.v1') BEGIN
 SELECT RAISE(ABORT,'Missing settlement dependency event') WHERE NEW.operation_kind IN ('earn.seal-input.v1','earn.commit-board.v1') AND NOT EXISTS(
  SELECT 1 FROM app_settlement_dependencies d WHERE d.dependency=CASE WHEN NEW.operation_kind='earn.seal-input.v1' THEN 'cutoff-evidence:' ELSE 'board:' END||json_extract(NEW.input_json,'$.epoch')
   AND d.digest=NEW.result_ref
 );
 SELECT RAISE(ABORT,'Missing settlement outbox') WHERE NOT EXISTS(
  SELECT 1 FROM app_job_outbox o WHERE o.source_key=json_extract(NEW.input_json,'$.outboxKey')
   AND json_extract(o.command_json,'$.input.sourceKey')=o.source_key
   AND json_extract(o.command_json,'$.input.businessKey')=o.source_key
   AND json_extract(o.command_json,'$.operationKind')='jobs.enqueue.v1'
   AND json_extract(o.command_json,'$.requestDigest')=o.request_digest
   AND json_extract(o.command_json,'$.principal.kind')='operator'
   AND json_extract(o.command_json,'$.input.payload.principal.kind')='operator'
   AND json_extract(o.command_json,'$.input.payload.principal.id')=json_extract(o.command_json,'$.principal.id')
   AND (NEW.operation_kind='earn.seal-input.v1' OR NEW.principal_key='operator:'||json_extract(o.command_json,'$.principal.id'))
   AND json_extract(o.command_json,'$.input.type')=CASE WHEN NEW.operation_kind='earn.seal-input.v1' THEN 'finalize-board' ELSE 'publish-archive' END
   AND json_extract(o.command_json,'$.input.payload.epoch')=CASE WHEN NEW.operation_kind='earn.commit-allocation.v1'
    THEN json_extract(NEW.input_json,'$.boardEpoch') ELSE json_extract(NEW.input_json,'$.epoch') END
   AND (NEW.operation_kind<>'earn.commit-board.v1' OR json_extract(o.command_json,'$.input.payload.snapshotId')=NEW.result_ref)
   AND (NEW.operation_kind<>'earn.commit-allocation.v1' OR
    (json_extract(o.command_json,'$.input.payload.tokenId')=json_extract(NEW.input_json,'$.tokenId')
     AND json_extract(o.command_json,'$.input.payload.day')=json_extract(NEW.input_json,'$.day')
     AND json_extract(o.command_json,'$.input.payload.snapshotId')=json_extract(NEW.input_json,'$.boardDigest')))
 );
END;
CREATE TABLE app_settlement_incidents (
 id TEXT PRIMARY KEY,epoch INTEGER NOT NULL,snapshot_hash TEXT NOT NULL,manifest_digest TEXT NOT NULL,
 previous_evidence_digest TEXT NOT NULL,current_evidence_digest TEXT NOT NULL,dependency_ids TEXT NOT NULL,
 source_revision TEXT NOT NULL,created_ms INTEGER NOT NULL,operator TEXT NOT NULL,
 FOREIGN KEY(epoch) REFERENCES earn_boards(epoch)
) STRICT;
CREATE TRIGGER app_settlement_incidents_no_update BEFORE UPDATE ON app_settlement_incidents
 BEGIN SELECT RAISE(ABORT,'Settlement incidents are immutable'); END;
CREATE TRIGGER app_settlement_incidents_no_delete BEFORE DELETE ON app_settlement_incidents
 BEGIN SELECT RAISE(ABORT,'Retain settlement reconciliation incidents'); END;
