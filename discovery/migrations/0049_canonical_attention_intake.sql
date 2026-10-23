-- Current canonical state is research evidence, not historical migration proof.
-- One immutable original plan per mint and UTC hour; failures remain spent.
CREATE TABLE tenx_canonical_intakes (
  address TEXT PRIMARY KEY,
  utc_hour TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL UNIQUE REFERENCES tenx_jobs(id),
  plan_hash TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(json_valid(plan) AND length(CAST(plan AS BLOB))<=32000),
  created_at TEXT NOT NULL
);
CREATE TABLE tenx_canonical_intake_receipts (
  address TEXT PRIMARY KEY REFERENCES tenx_canonical_intakes(address),
  receipt_hash TEXT NOT NULL,
  receipt TEXT NOT NULL CHECK(json_valid(receipt) AND length(CAST(receipt AS BLOB))<=1800000),
  observed_at TEXT NOT NULL
);
CREATE TRIGGER tenx_canonical_intake_plan_no_update BEFORE UPDATE ON tenx_canonical_intakes BEGIN SELECT RAISE(ABORT,'canonical_intake_immutable'); END;
CREATE TRIGGER tenx_canonical_intake_plan_no_delete BEFORE DELETE ON tenx_canonical_intakes BEGIN SELECT RAISE(ABORT,'canonical_intake_immutable'); END;
CREATE TRIGGER tenx_canonical_intake_receipt_no_update BEFORE UPDATE ON tenx_canonical_intake_receipts BEGIN SELECT RAISE(ABORT,'canonical_intake_immutable'); END;
CREATE TRIGGER tenx_canonical_intake_receipt_no_delete BEFORE DELETE ON tenx_canonical_intake_receipts BEGIN SELECT RAISE(ABORT,'canonical_intake_immutable'); END;
