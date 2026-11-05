-- Public recovery store. Private sessions and moderation evidence are never exported.
CREATE TABLE earn_recovered_boards (
  epoch INTEGER PRIMARY KEY, board_id TEXT NOT NULL UNIQUE, board_json TEXT NOT NULL
) STRICT;
CREATE TABLE earn_recovered_allocations (
  token_id TEXT NOT NULL, day INTEGER NOT NULL, epoch INTEGER NOT NULL REFERENCES earn_recovered_boards,
  allocation_id TEXT NOT NULL, allocation_json TEXT NOT NULL, PRIMARY KEY(token_id,day)
) STRICT;
CREATE TABLE earn_recovered_awards (
  wallet TEXT NOT NULL, token_id TEXT NOT NULL, day INTEGER NOT NULL, amount TEXT NOT NULL,
  vests_from_ms INTEGER NOT NULL, vests_through_ms INTEGER NOT NULL, PRIMARY KEY(wallet,token_id,day),
  FOREIGN KEY(token_id,day) REFERENCES earn_recovered_allocations
) STRICT;
CREATE INDEX earn_recovered_wallet ON earn_recovered_awards(wallet);
-- Recovery stores serve awards without becoming writable replicas of missing private state.
CREATE TRIGGER earn_recovery_guard_campaign BEFORE INSERT ON earn_fixture_campaigns
WHEN EXISTS(SELECT 1 FROM earn_recovered_boards) BEGIN SELECT RAISE(ABORT,'Earn recovery store is read-only'); END;
CREATE TRIGGER earn_recovery_guard_board BEFORE INSERT ON earn_boards
WHEN EXISTS(SELECT 1 FROM earn_recovered_boards) BEGIN SELECT RAISE(ABORT,'Earn recovery store is read-only'); END;
