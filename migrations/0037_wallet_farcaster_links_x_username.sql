ALTER TABLE wallet_farcaster_links ADD COLUMN x_username TEXT;

CREATE INDEX IF NOT EXISTS idx_wallet_farcaster_links_x_username
  ON wallet_farcaster_links(x_username);
