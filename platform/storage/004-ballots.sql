CREATE TABLE genesis_ballots(
 id TEXT PRIMARY KEY, opens_ms INTEGER NOT NULL, closes_ms INTEGER NOT NULL, tranche_open_ms INTEGER NOT NULL,
 snapshot_hash TEXT NOT NULL, eligible_count INTEGER NOT NULL
) STRICT;
CREATE TABLE genesis_voters(
 ballot_id TEXT NOT NULL REFERENCES genesis_ballots, wallet TEXT NOT NULL,
 PRIMARY KEY(ballot_id,wallet)
) WITHOUT ROWID;
CREATE TABLE genesis_votes(
 ballot_id TEXT NOT NULL, wallet TEXT NOT NULL, choice TEXT NOT NULL CHECK(choice IN('ASAP','7','14','30')),
 voted_ms INTEGER NOT NULL, PRIMARY KEY(ballot_id,wallet),
 FOREIGN KEY(ballot_id,wallet) REFERENCES genesis_voters(ballot_id,wallet)
) WITHOUT ROWID;
CREATE TABLE genesis_decisions(
 ballot_id TEXT PRIMARY KEY REFERENCES genesis_ballots, choice TEXT NOT NULL,
 decided_ms INTEGER NOT NULL, notice_ms INTEGER NOT NULL, earliest_ms INTEGER NOT NULL, rationale TEXT NOT NULL
) STRICT;
