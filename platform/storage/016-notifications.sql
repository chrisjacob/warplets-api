CREATE TABLE notice_preferences (
 wallet TEXT NOT NULL,channel TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 topics TEXT NOT NULL,terms TEXT NOT NULL,changed_ms INTEGER NOT NULL,PRIMARY KEY(wallet,channel)
) STRICT;
CREATE TABLE notice_consent_requests (
 wallet TEXT NOT NULL,channel TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,revision INTEGER NOT NULL,
 changed_ms INTEGER NOT NULL,PRIMARY KEY(wallet,channel,request_key)
) STRICT;
CREATE TABLE notice_outbox (
 id TEXT PRIMARY KEY,wallet TEXT NOT NULL,channel TEXT NOT NULL,consent_revision INTEGER NOT NULL,topic TEXT NOT NULL,
 subject TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,target TEXT NOT NULL,created_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','leased','retry','delivered','unknown','cancelled')),
 attempts INTEGER NOT NULL,ready_ms INTEGER NOT NULL,lease TEXT,lease_until_ms INTEGER
) STRICT;
CREATE INDEX notice_ready ON notice_outbox(state,ready_ms,id);
CREATE INDEX notice_lease_timeout ON notice_outbox(state,lease_until_ms);
CREATE INDEX notice_daily_cap ON notice_outbox(wallet,created_ms);
CREATE INDEX notice_expiry ON notice_outbox(expires_ms);
CREATE TABLE notice_inbox (
 id TEXT PRIMARY KEY REFERENCES notice_outbox ON DELETE CASCADE,wallet TEXT NOT NULL,delivered_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX notice_inbox_wallet ON notice_inbox(wallet,delivered_ms DESC,id DESC);
