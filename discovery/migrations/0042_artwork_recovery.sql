-- Presentation-only recovery; candidate/election/score evidence is untouched.
ALTER TABLE tenx_artwork ADD COLUMN image_candidate TEXT;
ALTER TABLE tenx_artwork ADD COLUMN reader_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenx_artwork_control ADD COLUMN lease_owner TEXT;
