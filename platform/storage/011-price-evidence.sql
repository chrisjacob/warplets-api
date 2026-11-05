-- Source rules are fixed per local campaign. Observations are immutable revisions.
CREATE TABLE price_sources (
  token_id TEXT PRIMARY KEY REFERENCES earn_fixture_campaigns, policy TEXT NOT NULL, policy_hash TEXT NOT NULL
) STRICT;
CREATE TABLE price_observations (
  receipt TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES price_sources, wallet TEXT NOT NULL, as_of_ms INTEGER NOT NULL,
  revision INTEGER NOT NULL, supersedes TEXT REFERENCES price_observations, policy_hash TEXT NOT NULL,
  raw_evidence TEXT NOT NULL, decision TEXT NOT NULL, read_id TEXT REFERENCES earn_stake_reads,
  UNIQUE(token_id,wallet,as_of_ms,revision)
) STRICT;
CREATE INDEX price_checkpoint ON price_observations(wallet,token_id,as_of_ms DESC,revision DESC);
