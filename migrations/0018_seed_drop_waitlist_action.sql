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
  'drop-waitlist-email',
  'Join 10X Meme Waitlist',
  'Submit and verify your email to secure your waitlist spot.',
  'email_subscribe',
  NULL,
  NULL,
  NULL,
  NULL,
  'email_verified',
  'drop',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM actions WHERE slug = 'drop-waitlist-email'
);
