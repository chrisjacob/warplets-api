-- Isolated, local fixtures. These tables have no binding to real token balances.
CREATE TABLE earn_fixture_campaigns (
  token_id TEXT PRIMARY KEY, activation_ms INTEGER NOT NULL, original_units TEXT NOT NULL
) STRICT;
CREATE TABLE earn_stake_reads (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, token_id TEXT NOT NULL REFERENCES earn_fixture_campaigns,
  observed_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, micro_usd TEXT NOT NULL,
  source_ref TEXT NOT NULL, UNIQUE(wallet,token_id,observed_ms)
) STRICT;
CREATE INDEX earn_stake_lookup ON earn_stake_reads(wallet,token_id,observed_ms DESC);
CREATE TABLE earn_submissions (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, token_id TEXT NOT NULL REFERENCES earn_fixture_campaigns,
  epoch INTEGER NOT NULL, url TEXT NOT NULL, submitted_ms INTEGER NOT NULL,
  entry_read_id TEXT NOT NULL REFERENCES earn_stake_reads, request_key TEXT NOT NULL,
  UNIQUE(wallet,request_key), UNIQUE(epoch,wallet,token_id)
) STRICT;
CREATE TABLE earn_reviews (
  submission_id TEXT PRIMARY KEY REFERENCES earn_submissions, content_score INTEGER NOT NULL CHECK(content_score BETWEEN 0 AND 10),
  moderator TEXT NOT NULL, reason TEXT NOT NULL, reviewed_ms INTEGER NOT NULL, source_ref TEXT NOT NULL
) STRICT;
CREATE INDEX earn_review_window ON earn_reviews(reviewed_ms);
CREATE TABLE earn_member_facts (
  epoch INTEGER NOT NULL, wallet TEXT NOT NULL, payload TEXT NOT NULL, source_ref TEXT NOT NULL,
  PRIMARY KEY(epoch,wallet)
) STRICT;
CREATE TABLE earn_boards (
  epoch INTEGER PRIMARY KEY, winners TEXT NOT NULL, finalized_ms INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL, source_ref TEXT NOT NULL
) STRICT;
CREATE TABLE earn_streaks (
  epoch INTEGER NOT NULL REFERENCES earn_boards, wallet TEXT NOT NULL, days INTEGER NOT NULL,
  last_approval_ms INTEGER NOT NULL, PRIMARY KEY(epoch,wallet)
) STRICT;
CREATE TABLE earn_decisions (
  submission_id TEXT PRIMARY KEY REFERENCES earn_submissions, epoch INTEGER NOT NULL REFERENCES earn_boards,
  qualified INTEGER NOT NULL CHECK(qualified IN (0,1)), snapshot_read_id TEXT REFERENCES earn_stake_reads
) STRICT;
CREATE TABLE earn_allocations (
  token_id TEXT NOT NULL REFERENCES earn_fixture_campaigns, day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 10),
  epoch INTEGER NOT NULL REFERENCES earn_boards, starts_ms INTEGER NOT NULL, vests_from_ms INTEGER NOT NULL,
  vests_through_ms INTEGER NOT NULL, budget TEXT NOT NULL, burn TEXT NOT NULL, PRIMARY KEY(token_id,day)
) STRICT;
CREATE INDEX earn_allocations_by_epoch ON earn_allocations(epoch);
CREATE TABLE earn_awards (
  token_id TEXT NOT NULL, day INTEGER NOT NULL, wallet TEXT NOT NULL, amount TEXT NOT NULL,
  PRIMARY KEY(token_id,day,wallet), FOREIGN KEY(token_id,day) REFERENCES earn_allocations
) STRICT;
CREATE INDEX earn_awards_by_wallet ON earn_awards(wallet);
