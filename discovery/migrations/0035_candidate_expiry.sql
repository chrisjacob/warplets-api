-- Logical expiry keeps every candidate payload and its dependent history.
CREATE TABLE tenx_candidate_expiry (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expired_at TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64),
  receipt TEXT NOT NULL CHECK(json_valid(receipt)),
  CHECK(julianday(expired_at)>julianday(created_at)+1),
  CHECK(json_extract(receipt,'$.version')='verified-creation-expiry-v1'),
  CHECK(json_extract(receipt,'$.address')=address),
  CHECK(json_extract(receipt,'$.creation.block_time')=created_at),
  CHECK(json_extract(receipt,'$.creation.payload_hash')=proof_hash),
  CHECK(json_extract(receipt,'$.expired_at')=expired_at)
);
CREATE TRIGGER tenx_candidate_expiry_proof BEFORE INSERT ON tenx_candidate_expiry BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenx_candidates c JOIN tenx_proofs p ON p.address=c.address AND p.kind='creation'
    WHERE c.mode='live' AND c.address=NEW.address
    AND p.payload=json_extract(c.payload,'$.creation')
    AND p.payload=json_extract(NEW.receipt,'$.creation')
    AND p.payload_hash=NEW.proof_hash
  ) THEN RAISE(ABORT,'candidate_expiry_proof_mismatch') END;
END;
CREATE TRIGGER tenx_candidate_expiry_no_update BEFORE UPDATE ON tenx_candidate_expiry BEGIN SELECT RAISE(ABORT,'immutable_candidate_expiry'); END;
CREATE TRIGGER tenx_candidate_expiry_no_delete BEFORE DELETE ON tenx_candidate_expiry BEGIN SELECT RAISE(ABORT,'immutable_candidate_expiry'); END;
CREATE VIEW tenx_active_candidates AS SELECT c.* FROM tenx_candidates c
  WHERE c.mode<>'live' OR NOT EXISTS(SELECT 1 FROM tenx_candidate_expiry e WHERE e.address=c.address);
