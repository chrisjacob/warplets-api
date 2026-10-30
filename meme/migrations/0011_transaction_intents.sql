-- Isolated local launchpad records only. These tables confer no signing authority.
CREATE TABLE meme_transaction_intents (
  id TEXT PRIMARY KEY,
  business_key TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL CHECK(network IN ('base-local','solana-local','base-mainnet','solana-mainnet')),
  operation TEXT NOT NULL CHECK(operation IN ('launch','create-distributor','fund','claim')),
  subject TEXT NOT NULL,
  plan TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('prepared','awaiting_approval','unknown','submitted','confirmed','failed')),
  simulation TEXT,
  signature TEXT UNIQUE,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER meme_transaction_plan_immutable BEFORE UPDATE OF id,business_key,network,operation,subject,plan,plan_hash,created_at ON meme_transaction_intents
BEGIN SELECT RAISE(ABORT,'Transaction intent is immutable'); END;
CREATE TABLE meme_transaction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id TEXT NOT NULL REFERENCES meme_transaction_intents(id),
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  evidence TEXT NOT NULL,
  UNIQUE(intent_id,revision)
);
CREATE TRIGGER meme_transaction_events_immutable BEFORE UPDATE ON meme_transaction_events
BEGIN SELECT RAISE(ABORT,'Transaction evidence is immutable'); END;
CREATE TABLE meme_financial_receipts (
  business_key TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES meme_transaction_intents(id),
  operation TEXT NOT NULL,
  subject TEXT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  evidence_hash TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL
);
CREATE TRIGGER meme_financial_receipts_immutable BEFORE UPDATE ON meme_financial_receipts
BEGIN SELECT RAISE(ABORT,'Financial receipt is immutable'); END;
