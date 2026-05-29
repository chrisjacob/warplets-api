CREATE TABLE IF NOT EXISTS million_watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  watched_on TEXT NOT NULL,
  updated_on TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_watchers_user
  ON million_watchers(user_id);

CREATE INDEX IF NOT EXISTS idx_million_watchers_watched_on
  ON million_watchers(watched_on DESC);
