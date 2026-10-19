-- Preserve both namespaces even if a synthetic example has the same mint as a
-- live asset. Copy before replacing; the migration runs transactionally in D1.
CREATE TABLE tenx_candidates_namespaced (
  address TEXT NOT NULL, pool TEXT NOT NULL, payload TEXT NOT NULL,
  checked_at TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN('live','fixture')),
  PRIMARY KEY(mode,address)
);
INSERT INTO tenx_candidates_namespaced SELECT address,pool,payload,checked_at,mode FROM tenx_candidates;
DROP TABLE tenx_candidates;
ALTER TABLE tenx_candidates_namespaced RENAME TO tenx_candidates;
CREATE INDEX tenx_candidates_checked ON tenx_candidates(mode,checked_at);
