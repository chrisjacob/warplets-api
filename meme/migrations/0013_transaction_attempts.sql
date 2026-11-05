-- Original intent and business key remain immutable; each reviewed retry has its own plan.
CREATE TABLE meme_transaction_attempts(
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES meme_transaction_intents(id),
  ordinal INTEGER NOT NULL,
  recovery_key TEXT NOT NULL,
  plan TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  previous_signature TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(intent_id,ordinal),
  UNIQUE(intent_id,recovery_key)
);
ALTER TABLE meme_transaction_intents ADD COLUMN current_attempt TEXT REFERENCES meme_transaction_attempts(id);
ALTER TABLE meme_transaction_intents ADD COLUMN chain_status TEXT NOT NULL DEFAULT 'prepared';
INSERT INTO meme_transaction_attempts SELECT id||':attempt:0',id,0,'initial',plan,plan_hash,NULL,'Initial immutable review record',created_at FROM meme_transaction_intents;
UPDATE meme_transaction_intents SET current_attempt=id||':attempt:0',chain_status=CASE WHEN state='confirmed' THEN 'legacy-local-confirmed' ELSE state END;
CREATE TRIGGER meme_attempt_no_update BEFORE UPDATE ON meme_transaction_attempts BEGIN SELECT RAISE(ABORT,'Transaction attempts are immutable'); END;
CREATE TRIGGER meme_attempt_no_delete BEFORE DELETE ON meme_transaction_attempts BEGIN SELECT RAISE(ABORT,'Transaction attempts are immutable'); END;
CREATE TABLE meme_transaction_approvals(
  attempt_id TEXT PRIMARY KEY REFERENCES meme_transaction_attempts(id),
  plan_hash TEXT NOT NULL,
  simulation_hash TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority='local-test-controller'),
  approved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TRIGGER meme_approval_no_update BEFORE UPDATE ON meme_transaction_approvals BEGIN SELECT RAISE(ABORT,'Transaction approvals are immutable'); END;
CREATE TRIGGER meme_approval_no_delete BEFORE DELETE ON meme_transaction_approvals BEGIN SELECT RAISE(ABORT,'Transaction approvals are immutable'); END;
