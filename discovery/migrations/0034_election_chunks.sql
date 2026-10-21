-- Large rehearsals retain every frozen input without exceeding a D1 row.
CREATE TABLE tenx_election_chunks (
  run_id TEXT NOT NULL REFERENCES tenx_election_runs(id),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
  payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB)) BETWEEN 1 AND 512000),
  payload_bytes INTEGER NOT NULL CHECK(payload_bytes=length(CAST(payload AS BLOB))),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  PRIMARY KEY(run_id,ordinal)
);
CREATE TRIGGER tenx_election_chunks_manifest BEFORE INSERT ON tenx_election_chunks BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM tenx_election_runs WHERE id=NEW.run_id
    AND json_extract(inputs,'$.version')='election-chunks-v1'
    AND json_extract(inputs,'$.chunks['||NEW.ordinal||'].payload_hash')=NEW.payload_hash
    AND json_extract(inputs,'$.chunks['||NEW.ordinal||'].bytes')=NEW.payload_bytes
  ) THEN RAISE(ABORT,'election_chunk_manifest_mismatch') END;
END;
CREATE TRIGGER tenx_election_chunks_no_update BEFORE UPDATE ON tenx_election_chunks BEGIN SELECT RAISE(ABORT,'immutable_election_chunk'); END;
CREATE TRIGGER tenx_election_chunks_no_delete BEFORE DELETE ON tenx_election_chunks BEGIN SELECT RAISE(ABORT,'immutable_election_chunk'); END;
