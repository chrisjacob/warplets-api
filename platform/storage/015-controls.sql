CREATE TABLE ops_scope_log (
  revision TEXT PRIMARY KEY, scope TEXT NOT NULL, paused INTEGER NOT NULL CHECK(paused IN (0,1)),
  previous_revision TEXT REFERENCES ops_scope_log, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
  evidence_ref TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE
) STRICT;
CREATE INDEX ops_scope_state ON ops_scope_log(scope,at_ms DESC);
CREATE TRIGGER ops_immutable_scope_update BEFORE UPDATE ON ops_scope_log BEGIN SELECT RAISE(ABORT,'Scope audit is append only'); END;
CREATE TRIGGER ops_immutable_scope_delete BEFORE DELETE ON ops_scope_log BEGIN SELECT RAISE(ABORT,'Scope audit is append only'); END;
CREATE TABLE ops_usage (
  receipt TEXT PRIMARY KEY, provider TEXT NOT NULL, metric TEXT NOT NULL, period TEXT NOT NULL, at_ms INTEGER NOT NULL,
  measured TEXT NOT NULL, quota TEXT, evidence_ref TEXT NOT NULL, UNIQUE(provider,metric,period,at_ms)
) STRICT;
CREATE INDEX ops_meter_period ON ops_usage(period,metric,provider,at_ms DESC);
CREATE INDEX ops_meter_provider ON ops_usage(metric,provider,at_ms DESC);
CREATE TRIGGER ops_usage_no_update BEFORE UPDATE ON ops_usage BEGIN SELECT RAISE(ABORT,'Usage evidence is append only'); END;
CREATE TRIGGER ops_usage_no_delete BEFORE DELETE ON ops_usage BEGIN SELECT RAISE(ABORT,'Usage evidence is append only'); END;
CREATE TABLE ops_optional_spend (
  request_key TEXT PRIMARY KEY, scope TEXT NOT NULL, period TEXT NOT NULL, at_ms INTEGER NOT NULL,
  limit_usd_micros TEXT NOT NULL, actor TEXT NOT NULL, quote_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reserved','settled')), actual_usd_micros TEXT, settlement_ref TEXT
) STRICT;
CREATE INDEX ops_spend_by_period ON ops_optional_spend(period,status);
CREATE TRIGGER ops_spend_no_delete BEFORE DELETE ON ops_optional_spend BEGIN SELECT RAISE(ABORT,'Spend history must be retained'); END;
CREATE TRIGGER ops_spend_sealed BEFORE UPDATE ON ops_optional_spend WHEN OLD.status='settled'
BEGIN SELECT RAISE(ABORT,'Settled spend is immutable'); END;
