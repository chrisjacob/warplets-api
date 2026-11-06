-- Ephemeral private fingerprint audit controls. No adoption/economic authority.
-- Excluded from business snapshots and watermark; any business write invalidates
-- the frozen source pin. Restored databases must start a new audit generation.
CREATE TABLE app_collection_legacy_audits (
 id TEXT PRIMARY KEY,operator TEXT NOT NULL,inventory_id TEXT NOT NULL REFERENCES collect_inventories(id),
 root_id TEXT NOT NULL REFERENCES app_collection_source_seals(id),source_revision INTEGER NOT NULL,
 declared_state_digest TEXT NOT NULL CHECK(length(declared_state_digest)=64),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND length(CAST(descriptor_json AS BLOB))<=131072),
 state TEXT NOT NULL CHECK(state IN ('working','fingerprints-ready','held')),
 phase TEXT NOT NULL CHECK(phase IN ('raw','canonical')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
 checkpoint_json TEXT CHECK(checkpoint_json IS NULL OR json_valid(checkpoint_json) AND length(CAST(checkpoint_json AS BLOB))<=8192),
 raw_digest TEXT CHECK(raw_digest IS NULL OR length(raw_digest)=64),
 canonical_digest TEXT CHECK(canonical_digest IS NULL OR length(canonical_digest)=64),
 last_nonce TEXT NOT NULL,reason TEXT,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,
 CHECK((phase='raw' AND raw_digest IS NULL AND canonical_digest IS NULL) OR (phase='canonical' AND raw_digest IS NOT NULL)),
 CHECK(state<>'fingerprints-ready' OR phase='canonical' AND canonical_digest IS NOT NULL AND canonical_digest=declared_state_digest AND checkpoint_json IS NULL),
 CHECK((state='held' AND reason IS NOT NULL) OR (state<>'held' AND reason IS NULL))
) STRICT;
CREATE TRIGGER collection_legacy_audit_initial BEFORE INSERT ON app_collection_legacy_audits WHEN
 NEW.state<>'working' OR NEW.phase<>'raw' OR NEW.revision<>0 OR NEW.checkpoint_json IS NOT NULL OR NEW.raw_digest IS NOT NULL OR NEW.canonical_digest IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'Legacy audit must begin with an empty private prefix'); END;
CREATE TRIGGER collection_legacy_audit_update BEFORE UPDATE ON app_collection_legacy_audits WHEN
 NEW.id<>OLD.id OR NEW.operator<>OLD.operator OR NEW.inventory_id<>OLD.inventory_id OR NEW.root_id<>OLD.root_id OR NEW.source_revision<>OLD.source_revision OR NEW.declared_state_digest<>OLD.declared_state_digest OR NEW.descriptor_json<>OLD.descriptor_json OR NEW.created_ms<>OLD.created_ms
 OR OLD.state<>'working' OR NEW.revision<>OLD.revision+1 OR NEW.last_nonce=OLD.last_nonce OR NEW.updated_ms<OLD.updated_ms
 OR (OLD.phase='canonical' AND (NEW.phase<>'canonical' OR NEW.raw_digest IS NOT OLD.raw_digest))
 OR (OLD.phase='raw' AND NEW.phase='canonical' AND NEW.checkpoint_json IS NOT NULL)
 OR (NEW.phase='raw' AND NEW.checkpoint_json IS NULL AND NEW.state<>'held')
 BEGIN SELECT RAISE(ABORT,'Retain immutable legacy audit identity and prefix progression'); END;
CREATE TRIGGER collection_legacy_audit_no_delete BEFORE DELETE ON app_collection_legacy_audits BEGIN SELECT RAISE(ABORT,'Retain private legacy audit history'); END;
