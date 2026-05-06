ALTER TABLE warplets_users RENAME COLUMN buy_on TO buy_in_opensea_on;
ALTER TABLE warplets_users RENAME COLUMN buy_transaction_on TO buy_in_farcaster_wallet_on;

DROP INDEX IF EXISTS idx_warplets_users_buy_on;
DROP INDEX IF EXISTS idx_warplets_users_buy_transaction_on;

CREATE INDEX IF NOT EXISTS idx_warplets_users_buy_in_opensea_on
  ON warplets_users(buy_in_opensea_on);

CREATE INDEX IF NOT EXISTS idx_warplets_users_buy_in_farcaster_wallet_on
  ON warplets_users(buy_in_farcaster_wallet_on);
