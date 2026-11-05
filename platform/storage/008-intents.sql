CREATE TABLE tx_intents (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL,
 plan_hash TEXT NOT NULL, plan TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL,
 created_ms INTEGER NOT NULL, UNIQUE(owner,action,subject)
) STRICT;
CREATE TABLE tx_request_keys(
 owner TEXT NOT NULL, action TEXT NOT NULL, request_key TEXT NOT NULL, intent_id TEXT NOT NULL REFERENCES tx_intents,
 PRIMARY KEY(owner,action,request_key)
) WITHOUT ROWID;
CREATE TABLE tx_attempts(
 id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES tx_intents, attempt_index INTEGER NOT NULL,
 message_hash TEXT NOT NULL, blockhash TEXT NOT NULL, packet TEXT NOT NULL, simulation_ref TEXT NOT NULL,
 state TEXT NOT NULL, signature TEXT UNIQUE, UNIQUE(intent_id,attempt_index), UNIQUE(intent_id,message_hash)
) STRICT;
CREATE TABLE tx_receipts(
 event_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES tx_attempts, observation TEXT NOT NULL, state TEXT NOT NULL
) STRICT;
