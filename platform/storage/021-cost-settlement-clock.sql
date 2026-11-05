-- Old rows lack a separate paid timestamp; retain their original event time on read.
ALTER TABLE ops_optional_spend ADD COLUMN settled_ms INTEGER;
CREATE INDEX ops_spend_settlement ON ops_optional_spend(status,settled_ms);
