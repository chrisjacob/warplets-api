ALTER TABLE warplets_users ADD COLUMN shared_on TEXT;

CREATE INDEX IF NOT EXISTS idx_warplets_users_shared_on
  ON warplets_users(shared_on);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  app_action TEXT,
  app_action_content TEXT,
  app_action_embeds TEXT,
  url TEXT,
  image TEXT,
  verification_method TEXT NOT NULL,
  app_slug TEXT NOT NULL,
  created_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_on TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_actions_app_slug
  ON actions(app_slug);

CREATE TABLE IF NOT EXISTS actions_completed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL,
  action_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  verification TEXT,
  created_on TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id),
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_completed_action_user
  ON actions_completed(action_id, user_id);

CREATE INDEX IF NOT EXISTS idx_actions_completed_user_fid
  ON actions_completed(user_fid);

CREATE INDEX IF NOT EXISTS idx_actions_completed_action_slug
  ON actions_completed(action_slug);

INSERT INTO actions (
  slug,
  name,
  description,
  app_action,
  app_action_content,
  app_action_embeds,
  url,
  image,
  verification_method,
  app_slug,
  created_on,
  updated_on
)
SELECT
  'drop-cast',
  'Drop Cast',
  'Cast about the 10X Warplet Drop.',
  'composeCast',
  'Claim your 10X Warplet! Rarity #{tokenId} of 10,000.',
  '["https://drop.10x.meme","https://warplets.10x.meme/{tokenId}.avif"]',
  NULL,
  NULL,
  'cast_hash_url',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM actions WHERE slug = 'drop-cast'
);
