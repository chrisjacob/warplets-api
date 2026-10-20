CREATE TABLE tenx_watchdog(id INTEGER PRIMARY KEY CHECK(id=1),checked_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE tenx_watchdog_events(id TEXT PRIMARY KEY,checked_at TEXT NOT NULL,payload TEXT NOT NULL);
CREATE INDEX tenx_watchdog_events_time ON tenx_watchdog_events(checked_at);
