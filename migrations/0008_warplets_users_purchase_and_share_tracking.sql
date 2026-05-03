ALTER TABLE warplets_users ADD COLUMN buy_transaction_on TEXT;
ALTER TABLE warplets_users ADD COLUMN shared_on TEXT;

CREATE INDEX IF NOT EXISTS idx_warplets_users_buy_transaction_on
  ON warplets_users(buy_transaction_on);

CREATE INDEX IF NOT EXISTS idx_warplets_users_shared_on
  ON warplets_users(shared_on);
