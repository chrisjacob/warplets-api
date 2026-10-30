-- Derived read index only. Finalized allocations and entitlements stay immutable.
CREATE TABLE meme_reward_campaign_index(
  fid INTEGER NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES meme_campaigns(id),
  launched_at INTEGER NOT NULL,
  PRIMARY KEY(fid,campaign_id)
) WITHOUT ROWID;
CREATE INDEX meme_reward_campaign_page ON meme_reward_campaign_index(fid,launched_at DESC,campaign_id DESC);
INSERT INTO meme_reward_campaign_index
SELECT DISTINCT e.fid,a.campaign_id,c.launched_at
FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id
JOIN meme_campaigns c ON c.id=a.campaign_id;
CREATE TRIGGER meme_entitlement_read_index AFTER INSERT ON meme_entitlements BEGIN
  INSERT OR IGNORE INTO meme_reward_campaign_index(fid,campaign_id,launched_at)
  SELECT NEW.fid,a.campaign_id,c.launched_at FROM meme_allocations a
  JOIN meme_campaigns c ON c.id=a.campaign_id WHERE a.id=NEW.allocation_id;
END;
CREATE INDEX meme_round_history_page ON meme_rounds(closes_at DESC,id DESC)
WHERE state IN('closed','selected','skipped');
