ALTER TABLE warplets_users ADD COLUMN buy_transaction_id TEXT;
ALTER TABLE warplets_users ADD COLUMN transaction_error TEXT;

CREATE INDEX IF NOT EXISTS idx_warplets_users_buy_transaction_id
  ON warplets_users(buy_transaction_id);
