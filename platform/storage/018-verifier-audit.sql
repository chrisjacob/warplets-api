CREATE TABLE ops_config_audit (
 seq INTEGER PRIMARY KEY,previous_hash TEXT,event_hash TEXT NOT NULL UNIQUE,
 category TEXT NOT NULL,entity TEXT NOT NULL,change_key TEXT NOT NULL,recorded_ms INTEGER NOT NULL,
 actor TEXT NOT NULL,evidence_ref TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(category,entity,change_key)
) STRICT;
CREATE TRIGGER ops_audit_no_edit BEFORE UPDATE ON ops_config_audit BEGIN SELECT RAISE(ABORT,'Configuration audit is append only'); END;
CREATE TRIGGER ops_audit_no_delete BEFORE DELETE ON ops_config_audit BEGIN SELECT RAISE(ABORT,'Configuration audit is append only'); END;
CREATE TABLE earn_issuer_grants (
 id TEXT PRIMARY KEY,action_id TEXT NOT NULL REFERENCES earn_action_catalog,verifier TEXT NOT NULL,pubkey TEXT NOT NULL,
 from_epoch INTEGER NOT NULL,until_epoch INTEGER NOT NULL,recorded_ms INTEGER NOT NULL,revision TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE earn_issuer_revocations (
 issuer_id TEXT PRIMARY KEY REFERENCES earn_issuer_grants,revoked_ms INTEGER NOT NULL,revision TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE earn_signed_completions (
 issuer_id TEXT NOT NULL REFERENCES earn_issuer_grants,nonce TEXT NOT NULL,wallet TEXT NOT NULL,
 action_id TEXT NOT NULL,proof_digest TEXT NOT NULL,source_hash TEXT NOT NULL,accepted_ms INTEGER NOT NULL,
 PRIMARY KEY(issuer_id,nonce),UNIQUE(wallet,action_id)
) STRICT;
CREATE TRIGGER earn_issuer_no_edit BEFORE UPDATE ON earn_issuer_grants BEGIN SELECT RAISE(ABORT,'Rotate with a new grant'); END;
CREATE TRIGGER earn_issuer_no_delete BEFORE DELETE ON earn_issuer_grants BEGIN SELECT RAISE(ABORT,'Retain issuer history'); END;
CREATE TRIGGER earn_revoke_no_edit BEFORE UPDATE ON earn_issuer_revocations BEGIN SELECT RAISE(ABORT,'Retain issuer history'); END;
CREATE TRIGGER earn_revoke_no_delete BEFORE DELETE ON earn_issuer_revocations BEGIN SELECT RAISE(ABORT,'Retain issuer history'); END;
