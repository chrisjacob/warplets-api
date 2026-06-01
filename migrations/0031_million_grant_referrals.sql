ALTER TABLE million_grant_applications ADD COLUMN referrer_application_id INTEGER;
ALTER TABLE million_grant_applications ADD COLUMN referrals_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_million_grant_applications_referrer
  ON million_grant_applications(referrer_application_id);

CREATE INDEX IF NOT EXISTS idx_million_grant_applications_referrals
  ON million_grant_applications(grant_month, referrals_count DESC, id);
