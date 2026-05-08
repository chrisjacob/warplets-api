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
  'drop-tweet',
  'Post on X',
  'Post about the 10X Warplet Drop on X.',
  'openUrl',
  NULL,
  NULL,
  NULL,
  NULL,
  'tweet_intent_opened',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM actions WHERE slug = 'drop-tweet'
);
