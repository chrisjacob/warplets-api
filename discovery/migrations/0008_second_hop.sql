CREATE TABLE tenx_second_hop_scans (
  address TEXT NOT NULL, wallet TEXT NOT NULL, anchor_signature TEXT NOT NULL,
  payload TEXT NOT NULL, payload_hash TEXT NOT NULL, attempted_at TEXT NOT NULL,
  PRIMARY KEY(address,wallet,anchor_signature)
);
