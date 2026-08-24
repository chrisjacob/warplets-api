-- Wallet-keyed favourites for the Search app.

CREATE TABLE IF NOT EXISTS warplet_favourites (
  wallet TEXT PRIMARY KEY,
  token_ids TEXT NOT NULL
);
