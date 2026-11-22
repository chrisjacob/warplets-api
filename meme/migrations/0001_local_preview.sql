-- Isolated local schema marker. Operational schemas follow resolved product decisions.
CREATE TABLE IF NOT EXISTS meme_schema_info(version INTEGER PRIMARY KEY, purpose TEXT NOT NULL);
INSERT OR IGNORE INTO meme_schema_info VALUES(1,'Local fixture preview; no financial or participant records');
