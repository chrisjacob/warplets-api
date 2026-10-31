ALTER TABLE meme_notification_settings ADD COLUMN milestones INTEGER NOT NULL DEFAULT 0 CHECK(milestones IN(0,1));
ALTER TABLE meme_social_drafts ADD COLUMN last_command_id TEXT;
ALTER TABLE meme_milestone_rules ADD COLUMN last_command_id TEXT;
CREATE INDEX meme_notice_priority ON meme_admin_notice_candidates(state,priority DESC,created_at);
