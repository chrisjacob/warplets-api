CREATE TABLE tenx_funding_reads (
  signature TEXT NOT NULL,
  reader_version TEXT NOT NULL,
  expected_slot INTEGER NOT NULL CHECK(expected_slot>=0),
  is_recovery INTEGER NOT NULL CHECK(is_recovery IN (0,1)),
  job_id TEXT,
  address TEXT,
  source_evidence_hash TEXT,
  hop TEXT CHECK(hop IN ('direct','second')),
  wallet TEXT,
  anchor_key TEXT,
  checkpoint_hash TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('reading','finished')),
  outcome TEXT,
  payload_hash TEXT,
  PRIMARY KEY(signature,reader_version),
  CHECK((state='reading' AND finished_at IS NULL AND outcome IS NULL AND payload_hash IS NULL)
     OR (state='finished' AND finished_at IS NOT NULL AND outcome IS NOT NULL)),
  CHECK(is_recovery=0 OR (job_id IS NOT NULL AND address IS NOT NULL AND source_evidence_hash IS NOT NULL
    AND hop IS NOT NULL AND wallet IS NOT NULL AND anchor_key IS NOT NULL AND checkpoint_hash IS NOT NULL)),
  CHECK(outcome IS NOT 'available' OR payload_hash IS NOT NULL)
);
CREATE INDEX tenx_funding_reads_day ON tenx_funding_reads(is_recovery,started_at);
CREATE TRIGGER tenx_funding_reads_immutable BEFORE UPDATE ON tenx_funding_reads
WHEN OLD.state='finished' OR NEW.signature IS NOT OLD.signature OR NEW.reader_version IS NOT OLD.reader_version
  OR NEW.expected_slot IS NOT OLD.expected_slot OR NEW.is_recovery IS NOT OLD.is_recovery OR NEW.job_id IS NOT OLD.job_id
  OR NEW.address IS NOT OLD.address OR NEW.source_evidence_hash IS NOT OLD.source_evidence_hash OR NEW.hop IS NOT OLD.hop
  OR NEW.wallet IS NOT OLD.wallet OR NEW.anchor_key IS NOT OLD.anchor_key OR NEW.checkpoint_hash IS NOT OLD.checkpoint_hash
  OR NEW.started_at IS NOT OLD.started_at
BEGIN SELECT RAISE(ABORT,'funding_read_immutable'); END;
CREATE TRIGGER tenx_funding_reads_no_delete BEFORE DELETE ON tenx_funding_reads
BEGIN SELECT RAISE(ABORT,'funding_read_immutable'); END;
