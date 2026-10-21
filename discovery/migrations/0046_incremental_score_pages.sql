-- Old derived rows remain unmodified until an admitted rebuild. The v2 manifest
-- contract holds old projections; raw evidence and frozen score records are untouched.
ALTER TABLE tenx_score_page_cards ADD COLUMN body_hash TEXT NOT NULL DEFAULT ''
  CHECK(body_hash='' OR length(body_hash)=64);
CREATE TABLE tenx_score_page_summaries (
  page INTEGER PRIMARY KEY CHECK(page>=0 AND page<20),
  payload TEXT NOT NULL CHECK(json_valid(payload) AND length(CAST(payload AS BLOB))<=100000)
);
