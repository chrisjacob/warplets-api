CREATE TABLE stake_fixture_farms (
 market_id TEXT PRIMARY KEY REFERENCES market_fixtures(id), activation_ms INTEGER NOT NULL,
 original_units TEXT NOT NULL, funded_units TEXT NOT NULL, treasury_fee_bps INTEGER NOT NULL
) STRICT;
CREATE TABLE stake_fixture_events (
 seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, market_id TEXT NOT NULL REFERENCES stake_fixture_farms,
 kind TEXT NOT NULL CHECK(kind IN('deposit','withdraw','harvest')), wallet TEXT NOT NULL, at_ms INTEGER NOT NULL, amount TEXT
) STRICT;
CREATE INDEX stake_events_by_farm ON stake_fixture_events(market_id,at_ms,seq);
CREATE INDEX stake_events_by_wallet ON stake_fixture_events(wallet,market_id);
