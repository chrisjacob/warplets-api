-- Disposable derived cards only; original evidence/replay tables are unchanged.
CREATE TABLE tenx_score_page_manifest (
  id INTEGER PRIMARY KEY CHECK(id=1),
  source_revision INTEGER NOT NULL,
  cutoff TEXT NOT NULL,
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=600000)
);
CREATE TABLE tenx_score_page_cards (
  address TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL CHECK(length(manifest_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=16000)
);
