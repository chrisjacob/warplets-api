CREATE TABLE tenx_inbox_reads (
  signature TEXT NOT NULL,
  reader_version TEXT NOT NULL,
  job_id TEXT NOT NULL,
  is_recovery INTEGER NOT NULL CHECK(is_recovery IN(0,1)),
  expected_slot INTEGER NOT NULL CHECK(expected_slot>=0),
  prior_result TEXT,
  prior_processed_at TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK(state IN('reading','finished')),
  outcome TEXT,
  payload_hash TEXT,
  PRIMARY KEY(signature,reader_version),
  CHECK((state='reading' AND finished_at IS NULL AND outcome IS NULL AND payload_hash IS NULL)
    OR (state='finished' AND finished_at IS NOT NULL AND outcome IS NOT NULL)),
  CHECK(is_recovery=0 OR (prior_result='unsupported_transaction_version' AND prior_processed_at IS NOT NULL))
);
CREATE INDEX tenx_inbox_reads_day ON tenx_inbox_reads(is_recovery,started_at);
CREATE INDEX tenx_pending_recovery ON tenx_pending_signatures(result,queued_at,slot);
CREATE TRIGGER tenx_inbox_reads_immutable_identity BEFORE UPDATE ON tenx_inbox_reads
WHEN OLD.state='finished' OR NEW.signature<>OLD.signature OR NEW.reader_version<>OLD.reader_version
  OR NEW.job_id<>OLD.job_id OR NEW.is_recovery<>OLD.is_recovery OR NEW.expected_slot<>OLD.expected_slot
  OR NEW.prior_result IS NOT OLD.prior_result OR NEW.prior_processed_at IS NOT OLD.prior_processed_at
  OR NEW.started_at<>OLD.started_at
BEGIN SELECT RAISE(ABORT,'immutable_inbox_read'); END;
CREATE TRIGGER tenx_inbox_reads_no_delete BEFORE DELETE ON tenx_inbox_reads
BEGIN SELECT RAISE(ABORT,'immutable_inbox_read'); END;
