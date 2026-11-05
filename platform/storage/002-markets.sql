-- Offline catalog. There is deliberately no relation to any live binding.
CREATE TABLE market_fixtures(
  seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, att_mint TEXT UNIQUE NOT NULL,
  pool_address TEXT UNIQUE NOT NULL, body TEXT NOT NULL
) STRICT;
