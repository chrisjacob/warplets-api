ALTER TABLE actions ADD COLUMN entry_value INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS million_giveaway_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_month TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  email TEXT NOT NULL,
  entry_source TEXT NOT NULL DEFAULT 'email',
  created_on TEXT NOT NULL,
  updated_on TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_giveaway_entries_user_month
  ON million_giveaway_entries(user_id, giveaway_month);

CREATE INDEX IF NOT EXISTS idx_million_giveaway_entries_month_created
  ON million_giveaway_entries(giveaway_month, created_on DESC);

CREATE TABLE IF NOT EXISTS million_giveaway_action_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  giveaway_month TEXT NOT NULL,
  action_id INTEGER NOT NULL,
  action_slug TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  user_fid INTEGER NOT NULL,
  entries_awarded INTEGER NOT NULL,
  verification TEXT,
  created_on TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(id),
  FOREIGN KEY (user_id) REFERENCES warplets_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_million_giveaway_action_entries_action_user_month
  ON million_giveaway_action_entries(action_id, user_id, giveaway_month);

CREATE INDEX IF NOT EXISTS idx_million_giveaway_action_entries_month
  ON million_giveaway_action_entries(giveaway_month);

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT
  'million-enter-email',
  'Enter the $500K -> $50 Giveaway',
  'Subscribe and verify your email to enter the giveaway.',
  'emailSubscribe',
  NULL,
  NULL,
  NULL,
  NULL,
  'email_verified',
  'million',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-enter-email');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT
  'million-cast',
  'Post on Farcaster',
  'Post about the $1M Warplet on Farcaster.',
  'composeCast',
  NULL,
  NULL,
  NULL,
  NULL,
  'pending',
  'million',
  2,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-cast');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT
  'million-tweet',
  'Post on X',
  'Post about the $1M Warplet on X.',
  'openUrl',
  NULL,
  NULL,
  NULL,
  NULL,
  'pending',
  'million',
  2,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-tweet');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-follow-fc-10xmeme', 'Follow @10XMeme.eth', 'Follow 10X Meme on Farcaster.', 'viewProfile', NULL, NULL, NULL, NULL, 'farcaster_follow_fid_1313340', 'million', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-follow-fc-10xmeme');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-follow-fc-10xchris', 'Follow 10XChris.eth', 'Follow Chris on Farcaster.', 'viewProfile', NULL, NULL, NULL, NULL, 'farcaster_follow_fid_1129138', 'million', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-follow-fc-10xchris');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-follow-x-10xmeme', 'Follow 10XMemeX on X', 'Follow 10X Meme on X.', 'openUrl', NULL, NULL, 'https://twitter.com/intent/follow?user_id=3275559396', NULL, 'pending', 'million', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-follow-x-10xmeme');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-follow-x-10xchris', 'Follow 10XChrisX on X', 'Follow Chris on X.', 'openUrl', NULL, NULL, 'https://twitter.com/intent/follow?user_id=18302782', NULL, 'pending', 'million', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-follow-x-10xchris');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-join-fc-channel', 'Join Farcaster Channel', 'Join the /10xmeme Farcaster channel.', 'openUrl', NULL, NULL, 'https://farcaster.xyz/~/channel/10xmeme', NULL, 'pending', 'million', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-join-fc-channel');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, entry_value, created_on, updated_on
)
SELECT 'million-join-telegram', 'Join Telegram Channel', 'Join the 10X Telegram community.', 'openUrl', NULL, NULL, 'https://t.me/X10XMeme', NULL, 'pending', 'million', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'million-join-telegram');
