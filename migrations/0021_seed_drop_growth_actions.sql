INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-follow-fc-10xmeme',
  'Follow @10XMeme.eth on Farcaster',
  'Follow the 10X Meme account on Farcaster.',
  'viewProfile',
  NULL,
  NULL,
  NULL,
  NULL,
  'farcaster_follow_fid_1313340',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-follow-fc-10xmeme');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-follow-fc-10xchris',
  'Follow @10XChris.eth on Farcaster',
  'Follow Chris on Farcaster for launches and updates.',
  'viewProfile',
  NULL,
  NULL,
  NULL,
  NULL,
  'farcaster_follow_fid_1129138',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-follow-fc-10xchris');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-follow-x-10xmeme',
  'Follow @10XMemeX on X (Twitter)',
  'Follow the 10X Meme account on X.',
  'openUrl',
  NULL,
  NULL,
  'https://twitter.com/intent/follow?user_id=3275559396',
  NULL,
  'assume_success',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-follow-x-10xmeme');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-follow-x-10xchris',
  'Follow @10XChrisX on X (Twitter)',
  'Follow Chris on X for launches and updates.',
  'openUrl',
  NULL,
  NULL,
  'https://twitter.com/intent/follow?user_id=18302782',
  NULL,
  'assume_success',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-follow-x-10xchris');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-join-fc-channel',
  'Join Farcaster Channel',
  'Join the /10xmeme Farcaster channel.',
  'openUrl',
  NULL,
  NULL,
  'https://farcaster.xyz/~/channel/10xmeme',
  NULL,
  'farcaster_channel_follow_10xmeme',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-join-fc-channel');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-join-telegram',
  'Join Telegram Channel',
  'Join the 10X Telegram community.',
  'openUrl',
  NULL,
  NULL,
  'https://t.me/X10XMeme',
  NULL,
  'assume_success',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-join-telegram');

INSERT INTO actions (
  slug, name, description, app_action, app_action_content, app_action_embeds, url, image, verification_method, app_slug, created_on, updated_on
)
SELECT
  'drop-email-10x',
  'Send an email to 10x@10x.meme',
  'Tell me what you would do if you won $500,000.',
  'openUrl',
  NULL,
  NULL,
  'mailto:10x@10x.meme?subject=If%20I%20won%20%24500%2C000...&body=If%20I%20won%20%24500%2C000...',
  NULL,
  'assume_success',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM actions WHERE slug = 'drop-email-10x');
