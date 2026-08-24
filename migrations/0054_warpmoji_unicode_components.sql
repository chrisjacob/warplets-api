-- Backfill the nine standalone Unicode Emoji v17 components for local databases
-- that applied an early generated catalog. Fresh databases already receive these
-- rows from 0052; INSERT OR IGNORE keeps this migration idempotent.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO warpmoji_emoji_groups (canonical_emoji, cldr_name, keywords_json, unicode_version, candidate_count, approved_count)
VALUES
  ('🏻', 'light skin tone', '["light","skin","tone"]', '17.0', 0, 0),
  ('🏼', 'medium-light skin tone', '["medium-light","skin","tone"]', '17.0', 0, 0),
  ('🏽', 'medium skin tone', '["medium","skin","tone"]', '17.0', 0, 0),
  ('🏾', 'medium-dark skin tone', '["medium-dark","skin","tone"]', '17.0', 0, 0),
  ('🏿', 'dark skin tone', '["dark","skin","tone"]', '17.0', 0, 0),
  ('🦰', 'red hair', '["red","hair"]', '17.0', 0, 0),
  ('🦱', 'curly hair', '["curly","hair"]', '17.0', 0, 0),
  ('🦳', 'white hair', '["white","hair"]', '17.0', 0, 0),
  ('🦲', 'bald', '["bald"]', '17.0', 0, 0);

INSERT OR IGNORE INTO warpmoji_emoji_aliases (alias, canonical_emoji, codepoints, is_rgi)
VALUES
  ('🏻', '🏻', '1F3FB', 1),
  ('🏼', '🏼', '1F3FC', 1),
  ('🏽', '🏽', '1F3FD', 1),
  ('🏾', '🏾', '1F3FE', 1),
  ('🏿', '🏿', '1F3FF', 1),
  ('🦰', '🦰', '1F9B0', 1),
  ('🦱', '🦱', '1F9B1', 1),
  ('🦳', '🦳', '1F9B3', 1),
  ('🦲', '🦲', '1F9B2', 1);
