-- Preserve the completed boundary while one bounded authority page is read per
-- ordinary harvest. This does not repair signatures skipped by older readers.
ALTER TABLE tenx_control ADD COLUMN harvest_head TEXT;
ALTER TABLE tenx_control ADD COLUMN harvest_before TEXT;
ALTER TABLE tenx_control ADD COLUMN harvest_before_slot INTEGER;
ALTER TABLE tenx_control ADD COLUMN harvest_revision INTEGER NOT NULL DEFAULT 0 CHECK(harvest_revision>=0);
ALTER TABLE tenx_control ADD COLUMN harvest_commit TEXT;
ALTER TABLE tenx_control ADD COLUMN harvest_authority TEXT;
