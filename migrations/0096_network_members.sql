-- Public profile presentation, isolated from acceptance evidence and finances.
CREATE TABLE IF NOT EXISTS network_member_profiles (
  fid INTEGER PRIMARY KEY CHECK(fid > 0), username TEXT, display_name TEXT,
  avatar_url TEXT, observed_at INTEGER NOT NULL, source TEXT NOT NULL
);
