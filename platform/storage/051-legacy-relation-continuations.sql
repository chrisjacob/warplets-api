-- Private relation continuations depend on a frozen050fingerprint audit.
-- Excluded control state; no active collection/economic authority or receipts.
CREATE TABLE app_collection_legacy_relations (
 id TEXT PRIMARY KEY,parent_audit_id TEXT NOT NULL UNIQUE REFERENCES app_collection_legacy_audits(id),operator TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('working','ready','held')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
 checkpoint_json TEXT CHECK(checkpoint_json IS NULL OR json_valid(checkpoint_json) AND length(CAST(checkpoint_json AS BLOB))<=8192),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json) AND length(CAST(result_json AS BLOB))<=8192),
 last_nonce TEXT NOT NULL,reason TEXT,created_ms INTEGER NOT NULL,updated_ms INTEGER NOT NULL,
 CHECK(state<>'ready' OR result_json IS NOT NULL AND checkpoint_json IS NULL),
 CHECK(state='ready' OR result_json IS NULL),
 CHECK((state='held' AND reason IS NOT NULL) OR (state<>'held' AND reason IS NULL))
) STRICT;
CREATE TRIGGER collection_legacy_relation_initial BEFORE INSERT ON app_collection_legacy_relations BEGIN
 SELECT RAISE(ABORT,'Relation audit begins with an empty private prefix') WHERE NEW.state<>'working' OR NEW.revision<>0 OR NEW.checkpoint_json IS NOT NULL OR NEW.result_json IS NOT NULL;
 SELECT RAISE(ABORT,'Relation audit requires private frozen fingerprints') WHERE NOT EXISTS(SELECT 1 FROM app_collection_legacy_audits p WHERE p.id=NEW.parent_audit_id AND p.operator=NEW.operator AND p.state='fingerprints-ready');
END;
CREATE TRIGGER collection_legacy_relation_update BEFORE UPDATE ON app_collection_legacy_relations WHEN
 NEW.id<>OLD.id OR NEW.parent_audit_id<>OLD.parent_audit_id OR NEW.operator<>OLD.operator OR NEW.created_ms<>OLD.created_ms
 OR OLD.state<>'working' OR NEW.revision<>OLD.revision+1 OR NEW.last_nonce=OLD.last_nonce OR NEW.updated_ms<OLD.updated_ms
 BEGIN SELECT RAISE(ABORT,'Retain immutable relation identity and prefix progression'); END;
CREATE TRIGGER collection_legacy_relation_ready BEFORE UPDATE ON app_collection_legacy_relations WHEN NEW.state='ready' BEGIN
 SELECT RAISE(ABORT,'Missing exact legacy source relation result') WHERE NOT EXISTS(
  SELECT 1 FROM app_collection_legacy_audits p WHERE p.id=NEW.parent_audit_id AND p.operator=NEW.operator AND p.state='fingerprints-ready'
   AND json_extract(NEW.result_json,'$.kind') IS 'verified'
   AND json_extract(NEW.result_json,'$.rootId') IS p.root_id AND json_extract(NEW.result_json,'$.inventoryId') IS p.inventory_id
   AND json_extract(NEW.result_json,'$.declaredStateDigest') IS p.canonical_digest
   AND json_extract(NEW.result_json,'$.pin.id') IS p.inventory_id AND json_extract(NEW.result_json,'$.pin.revision') IS p.source_revision
   AND json_extract(NEW.result_json,'$.pin.generation') IS json_extract(p.descriptor_json,'$.sourceGeneration')
   AND json_extract(NEW.result_json,'$.pin.watermark') IS json_extract(p.descriptor_json,'$.sourceWatermark')
   AND json_extract(NEW.result_json,'$.verification') IS 'source-components-equal-legacy-json'
   AND json_type(NEW.result_json,'$.relationDigest') IS 'text' AND length(json_extract(NEW.result_json,'$.relationDigest'))=64 AND json_extract(NEW.result_json,'$.relationDigest') NOT GLOB '*[^0-9a-f]*'
   AND json_extract(NEW.result_json,'$.canonicalDigestVerified') IS 0 AND json_extract(NEW.result_json,'$.rawByteDigestVerified') IS 0
   AND json_extract(NEW.result_json,'$.stageCount') IS (SELECT stage_count FROM app_collection_source_seals WHERE id=p.root_id)
   AND json_extract(NEW.result_json,'$.admissionCount') IS (SELECT admission_count FROM app_collection_source_seals WHERE id=p.root_id)
   AND json_extract(NEW.result_json,'$.economicsVerified') IS 0 AND json_extract(NEW.result_json,'$.adoptionAuthorized') IS 0 AND json_extract(NEW.result_json,'$.executable') IS 0
 );
END;
CREATE TRIGGER collection_legacy_relation_no_delete BEFORE DELETE ON app_collection_legacy_relations BEGIN SELECT RAISE(ABORT,'Retain private legacy relation history'); END;
