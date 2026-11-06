-- Excluded private recovery control storage for fragmented fair policy rows.
CREATE TABLE app_recovery_row_fragments (
 restore_id TEXT NOT NULL REFERENCES app_recovery_runs(id),
 table_name TEXT NOT NULL CHECK(table_name='fair_inventories'),
 page_index INTEGER NOT NULL CHECK(page_index BETWEEN 0 AND 16383),
 fragment_index INTEGER NOT NULL CHECK(fragment_index BETWEEN 0 AND 127),
 descriptor_digest TEXT NOT NULL CHECK(length(descriptor_digest)=64 AND descriptor_digest NOT GLOB '*[^a-f0-9]*'),
 byte_digest TEXT NOT NULL CHECK(length(byte_digest)=64 AND byte_digest NOT GLOB '*[^a-f0-9]*'),
 character_offset INTEGER NOT NULL CHECK(character_offset BETWEEN 1 AND 1048576),
 character_count INTEGER NOT NULL CHECK(character_count BETWEEN 1 AND 8192),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 32768),
 text TEXT NOT NULL CHECK(length(text)=character_count AND length(CAST(text AS BLOB))=size_bytes),
 PRIMARY KEY(restore_id,table_name,page_index,fragment_index)
) STRICT;
CREATE TRIGGER app_recovery_row_fragments_no_update BEFORE UPDATE ON app_recovery_row_fragments BEGIN SELECT RAISE(ABORT,'Retain immutable recovery fragments'); END;
CREATE TRIGGER app_recovery_row_fragments_no_delete BEFORE DELETE ON app_recovery_row_fragments BEGIN SELECT RAISE(ABORT,'Retain immutable recovery fragments'); END;
CREATE TRIGGER app_recovery_row_fragments_insert_guard BEFORE INSERT ON app_recovery_row_fragments
 WHEN NOT EXISTS(SELECT 1 FROM app_recovery_state s JOIN app_recovery_runs r ON r.id=s.active_restore_id
 WHERE s.id=1 AND s.mode='private' AND s.status='restoring' AND s.write_nonce IS NOT NULL
 AND r.id=NEW.restore_id AND r.mode='private' AND r.state='restoring'
 AND json_extract(r.checkpoint_json,'$.format')='10x.local.recovery.restore.v2')
 BEGIN SELECT RAISE(ABORT,'Recovery fragments require the active private restore nonce'); END;
