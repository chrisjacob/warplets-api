CREATE TABLE collect_level_history (
 seq INTEGER PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES collect_assets(id),
 effective_ms INTEGER NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 10),
 source_ref TEXT NOT NULL, UNIQUE(asset_id, source_ref)
) STRICT;
CREATE INDEX collect_level_asof ON collect_level_history(asset_id,effective_ms DESC,seq DESC);
-- Existing previews retained only the current Level. Keep this known observation.
INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref)
SELECT a.id,a.observed_ms,json_extract(a.asset,'$.level'),'migration.current-level'
FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE i.kind='season';
CREATE TABLE local_campaign_registry (
 market_id TEXT PRIMARY KEY REFERENCES market_fixtures(id), sydney_day TEXT UNIQUE NOT NULL,
 approved_digest TEXT NOT NULL, source_ref TEXT NOT NULL, observed_through_ms INTEGER NOT NULL, receipt TEXT NOT NULL
) STRICT;
