-- Wallet collection occurs after discovery. Freeze its own observation time;
-- never attach later wallet knowledge to an earlier price baseline.
CREATE TABLE tenx_wallet_cohorts (
  day TEXT NOT NULL, address TEXT NOT NULL, selected_at TEXT NOT NULL,
  input_hash TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(day,address)
);
