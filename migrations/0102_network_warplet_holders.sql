-- Derived Network-only index. Warplets ownership tables are read, never changed.
CREATE TABLE IF NOT EXISTS network_warplet_holders (
  fid INTEGER PRIMARY KEY,
  token_count INTEGER NOT NULL CHECK(token_count>0),
  calculated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS network_profiles_country ON network_profiles(country,fid);
