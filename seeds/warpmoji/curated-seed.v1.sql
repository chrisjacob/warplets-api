-- GENERATED FILE. Source of truth: curated-seed.v1.json
-- SHA-256: f673cbb9c92a4c1b1a771347b2acdf3204d7502103936d92a1a98c68381603c9
-- This replaces Warpmoji curation state; it does not replace the generated Unicode/candidate catalog.
PRAGMA foreign_keys = ON;
UPDATE warpmoji_candidates SET status = 'suggested', reviewed_at = NULL, reviewed_by_fid = NULL, updated_at = CURRENT_TIMESTAMP;
UPDATE warpmoji_emoji_groups SET reviewed_at = NULL, reviewed_by_fid = NULL, approved_count = 0, updated_at = CURRENT_TIMESTAMP;
DELETE FROM warpmoji_rejections;
UPDATE warpmoji_emoji_groups SET candidate_count = (SELECT COUNT(*) FROM warpmoji_candidates c WHERE c.canonical_emoji = warpmoji_emoji_groups.canonical_emoji);
INSERT INTO warpmoji_curated_seed_imports (checksum, seed_schema_version, unicode_version, scoring_versions_json, curation_updated_at, reviewed_group_count, approved_match_count, rejected_match_count) VALUES ('f673cbb9c92a4c1b1a771347b2acdf3204d7502103936d92a1a98c68381603c9', 1, '17.0', '["warpmoji-v1"]', NULL, 0, 0, 0) ON CONFLICT(checksum) DO UPDATE SET imported_at = CURRENT_TIMESTAMP;
