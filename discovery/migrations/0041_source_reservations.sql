-- Prepared source transport only: no schedule or activation is introduced.
-- Each HTTP attempt reserves one shared research slot before any network IO.
CREATE TABLE tenx_source_reservations (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
  request TEXT NOT NULL CHECK(json_valid(request)),
  reserved_at TEXT NOT NULL, lease_until TEXT NOT NULL, day TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','fetching','succeeded','failed')),
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 1900000),
  receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt)), receipt_hash TEXT
);
CREATE INDEX tenx_source_reservations_day ON tenx_source_reservations(day);
CREATE INDEX tenx_source_reservations_lease ON tenx_source_reservations(state,lease_until);
CREATE TABLE tenx_source_transport_control (
  id INTEGER PRIMARY KEY CHECK(id=1), next_at TEXT, backoff_until TEXT
);
INSERT INTO tenx_source_transport_control(id) VALUES(1);
