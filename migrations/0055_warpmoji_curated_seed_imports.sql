-- Records immutable provenance for Warpmoji curation seeds applied to this database.
CREATE TABLE IF NOT EXISTS warpmoji_curated_seed_imports (
  checksum TEXT PRIMARY KEY,
  seed_schema_version INTEGER NOT NULL,
  unicode_version TEXT NOT NULL,
  scoring_versions_json TEXT NOT NULL,
  curation_updated_at TEXT,
  reviewed_group_count INTEGER NOT NULL,
  approved_match_count INTEGER NOT NULL,
  rejected_match_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

