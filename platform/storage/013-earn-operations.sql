CREATE TABLE earn_workload_policies (
  revision TEXT PRIMARY KEY, effective_epoch INTEGER NOT NULL, recorded_ms INTEGER NOT NULL,
  staffed_minutes INTEGER NOT NULL, seconds_per_review INTEGER NOT NULL, admission_limit INTEGER NOT NULL,
  operator TEXT NOT NULL, reason TEXT NOT NULL, UNIQUE(effective_epoch,recorded_ms)
) STRICT;
CREATE INDEX earn_workload_schedule ON earn_workload_policies(effective_epoch DESC,recorded_ms DESC);
CREATE TABLE earn_admission_counts (epoch INTEGER PRIMARY KEY,admitted INTEGER NOT NULL CHECK(admitted>=0)) STRICT;
INSERT INTO earn_admission_counts SELECT epoch,COUNT(*) FROM earn_submissions GROUP BY epoch;
CREATE TRIGGER earn_count_admission AFTER INSERT ON earn_submissions BEGIN
  INSERT INTO earn_admission_counts VALUES(NEW.epoch,1) ON CONFLICT(epoch) DO UPDATE SET admitted=admitted+1;
END;
CREATE TRIGGER earn_remove_admission AFTER DELETE ON earn_submissions BEGIN
  UPDATE earn_admission_counts SET admitted=admitted-1 WHERE epoch=OLD.epoch;
END;
CREATE TRIGGER earn_hold_admission_epoch BEFORE UPDATE OF epoch ON earn_submissions
WHEN OLD.epoch<>NEW.epoch BEGIN SELECT RAISE(ABORT,'Earn admission epoch is immutable'); END;
CREATE INDEX earn_submission_queue ON earn_submissions(epoch);
CREATE INDEX price_observation_time ON price_observations(as_of_ms);
