-- Separate research history. Never rewrites canonical state, candidates or proofs.
CREATE TABLE tenx_attention_history_plans (
  id TEXT PRIMARY KEY REFERENCES tenx_jobs(id),
  address TEXT NOT NULL REFERENCES tenx_canonical_intakes(address),
  utc_hour TEXT NOT NULL,
  hour_slot INTEGER NOT NULL CHECK(hour_slot BETWEEN 1 AND 3),
  turn INTEGER NOT NULL CHECK(turn BETWEEN 1 AND 3),
  plan_hash TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(json_valid(plan) AND length(CAST(plan AS BLOB))<=32000),
  created_at TEXT NOT NULL,
  UNIQUE(utc_hour,hour_slot), UNIQUE(address,turn)
);
CREATE TABLE tenx_attention_history_reads (
  plan_id TEXT NOT NULL REFERENCES tenx_attention_history_plans(id),
  step INTEGER NOT NULL CHECK(step BETWEEN 0 AND 4),
  observation_hash TEXT NOT NULL,
  observation TEXT NOT NULL CHECK(json_valid(observation) AND length(CAST(observation AS BLOB))<=1800000),
  observed_at TEXT NOT NULL,
  PRIMARY KEY(plan_id,step)
);
CREATE TABLE tenx_attention_history_receipts (
  plan_id TEXT PRIMARY KEY REFERENCES tenx_attention_history_plans(id),
  receipt_hash TEXT NOT NULL,
  receipt TEXT NOT NULL CHECK(json_valid(receipt) AND length(CAST(receipt AS BLOB))<=32000),
  observed_at TEXT NOT NULL
);
CREATE TRIGGER tenx_attention_history_plan_no_update BEFORE UPDATE ON tenx_attention_history_plans BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
CREATE TRIGGER tenx_attention_history_plan_no_delete BEFORE DELETE ON tenx_attention_history_plans BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
CREATE TRIGGER tenx_attention_history_read_no_update BEFORE UPDATE ON tenx_attention_history_reads BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
CREATE TRIGGER tenx_attention_history_read_no_delete BEFORE DELETE ON tenx_attention_history_reads BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
CREATE TRIGGER tenx_attention_history_receipt_no_update BEFORE UPDATE ON tenx_attention_history_receipts BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
CREATE TRIGGER tenx_attention_history_receipt_no_delete BEFORE DELETE ON tenx_attention_history_receipts BEGIN SELECT RAISE(ABORT,'attention_history_immutable'); END;
