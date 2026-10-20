-- Artwork is presentation metadata, separate from immutable selection/evidence inputs.
CREATE TABLE tenx_artwork (
  address TEXT PRIMARY KEY,
  image_url TEXT,
  metadata_uri TEXT,
  creation_hash TEXT NOT NULL,
  metadata_hash TEXT,
  fetched_at TEXT,
  attempted_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE tenx_artwork_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lease_until TEXT,
  next_refresh_at TEXT,
  last_error TEXT
);
INSERT INTO tenx_artwork_control(id) VALUES(1);
