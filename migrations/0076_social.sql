CREATE TABLE IF NOT EXISTS social_members (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL, username TEXT NOT NULL, avatar TEXT,
 status TEXT NOT NULL DEFAULT 'active', bonus_opt_out INTEGER NOT NULL DEFAULT 0,
 next_post_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_members_group ON social_members(group_id);
CREATE TABLE IF NOT EXISTS social_identities (
 identity TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES social_members(id), created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_config (
 version INTEGER PRIMARY KEY AUTOINCREMENT, config_json TEXT NOT NULL, actor TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_posts (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES social_members(id), fid INTEGER,
 cast_hash TEXT UNIQUE, text TEXT NOT NULL, embeds_json TEXT NOT NULL DEFAULT '[]', raw_json TEXT,
 kind TEXT NOT NULL DEFAULT 'original', created_at INTEGER NOT NULL, submitted_at INTEGER,
 status TEXT NOT NULL DEFAULT 'visible', context_bonus REAL NOT NULL DEFAULT 0,
 rank REAL NOT NULL DEFAULT 1, likes INTEGER NOT NULL DEFAULT 0, comments INTEGER NOT NULL DEFAULT 0,
 recasts INTEGER NOT NULL DEFAULT 0, refreshed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS social_posts_feed ON social_posts(status,submitted_at);
CREATE INDEX IF NOT EXISTS social_posts_casts ON social_posts(fid,created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS social_search USING fts5(post_id UNINDEXED,text);
CREATE TRIGGER IF NOT EXISTS social_search_insert AFTER INSERT ON social_posts BEGIN INSERT INTO social_search(post_id,text) VALUES (new.id,new.text); END;
CREATE TRIGGER IF NOT EXISTS social_search_update AFTER UPDATE OF text ON social_posts BEGIN DELETE FROM social_search WHERE post_id=old.id; INSERT INTO social_search(post_id,text) VALUES(new.id,new.text); END;
CREATE TABLE IF NOT EXISTS social_bonus (fid INTEGER PRIMARY KEY, post_id TEXT NOT NULL REFERENCES social_posts(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_operations (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', cast_hash TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS social_interactions (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL, post_id TEXT NOT NULL REFERENCES social_posts(id),
 kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', delivery TEXT NOT NULL DEFAULT 'local', cast_hash TEXT,
 active INTEGER NOT NULL DEFAULT 1, native INTEGER NOT NULL DEFAULT 0, attempted_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE(member_id,post_id,kind)
);
CREATE INDEX IF NOT EXISTS social_interactions_post ON social_interactions(post_id,kind);
CREATE TABLE IF NOT EXISTS social_rewards (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL, event_key TEXT NOT NULL, action TEXT NOT NULL,
 post_id TEXT, day TEXT NOT NULL, base REAL NOT NULL, multiplier REAL NOT NULL, points REAL NOT NULL,
 config_version INTEGER NOT NULL, evidence_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(member_id,event_key)
);
CREATE INDEX IF NOT EXISTS social_rewards_member_day ON social_rewards(member_id,day,action);
CREATE TABLE IF NOT EXISTS social_checkins (tx_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL, wallet TEXT NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(wallet,day));
CREATE TABLE IF NOT EXISTS social_views (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, post_id TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, UNIQUE(member_id,post_id,started_at));
CREATE TABLE IF NOT EXISTS social_evidence (member_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_signers (member_id TEXT PRIMARY KEY, signer_uuid TEXT NOT NULL UNIQUE, fid INTEGER NOT NULL, status TEXT NOT NULL, approval_url TEXT, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_reports (id TEXT PRIMARY KEY, member_id TEXT NOT NULL, post_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(member_id,post_id));
CREATE TABLE IF NOT EXISTS social_mutes (member_id TEXT NOT NULL, target_id TEXT NOT NULL, PRIMARY KEY(member_id,target_id));
CREATE TABLE IF NOT EXISTS social_audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS social_jobs (id TEXT PRIMARY KEY, cursor INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS social_submissions (post_id TEXT PRIMARY KEY REFERENCES social_posts(id),member_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS social_submission_limit BEFORE INSERT ON social_submissions
WHEN EXISTS(SELECT 1 FROM social_members WHERE group_id=(SELECT group_id FROM social_members WHERE id=new.member_id) AND next_post_at>new.created_at)
BEGIN SELECT RAISE(ABORT,'social_cooldown'); END;
CREATE TRIGGER IF NOT EXISTS social_submission_accept AFTER INSERT ON social_submissions BEGIN
 UPDATE social_members SET next_post_at=new.created_at+86400000 WHERE group_id=(SELECT group_id FROM social_members WHERE id=new.member_id);
 UPDATE social_posts SET submitted_at=new.created_at WHERE id=new.post_id;
 DELETE FROM social_bonus WHERE post_id=new.post_id;
END;
